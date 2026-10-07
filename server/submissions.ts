// Runs: a logged-in user submits the form state, the server rebuilds the plan
// from it (src/lib/plan.ts) and makes the edits as that user, in order, in the
// background. Every edit of a run carries the run's EditGroups batch link in
// its summary, so the run can be reviewed (or undone) as one batch.
//
//   POST /api/submissions        start a run → { id }
//   GET  /api/submissions        the user's recent runs
//   GET  /api/submissions/:id    one run, with its edit log (the client polls this)
//
// One run per user at a time. Runs live in this process: a restart marks the
// ones it cut off as "interrupted", or "unknown" if a create was in flight
// (see markInterrupted). The client has already been told which items were
// created, so it can reuse them on a retry.
//
// A create that gets no answer may have been saved anyway, so it is never sent
// again: the run looks for the item (server/recover.ts) and carries on with it
// if found, or else ends "unknown". The user's next run looks again and, if
// still nothing turns up, needs them to confirm the item wasn't created.
import { randomBytes } from "node:crypto";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db.ts";
import { musicExternalIds, submissions, wikidataEdits } from "../db/schema.ts";
import { editEligibility } from "./auth/eligibility.ts";
import { type AuthEnv, type AuthUser, requireUser } from "./auth/session.ts";
import { fromSqlDatetime, toSqlDatetime } from "./auth/time.ts";
import { entityToRow, upsertRows } from "./mirror.ts";
import { propertyNumber, qidNumber, toQid } from "./ids.ts";
import { checkPlanQids } from "./check-qids.ts";
import { editPacer } from "./edit-pace.ts";
import { findCreated, waitForCreated } from "./recover.ts";
import {
  CREATE_TIMEOUT_MS,
  editRequest,
  type EditUser,
  type Entity,
  freshStatements,
  getEntities,
  toStatement,
  WikidataEditError,
} from "./wikidata-client.ts";
import { buildPlan, describeOp, type Op } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";
import { ALBUM_ID_FIELDS, ID_PROPERTIES } from "../src/lib/music.ts";
import type {
  EditLogEntry,
  SubmissionInfo,
  SubmissionListResponse,
  SubmissionRequest,
  SubmissionStatus,
  UnknownRunConflict,
} from "../src/lib/api-types.ts";

/** Appended to every edit summary so the edits are traceable to this tool. */
const TOOL_CREDIT = "Wikidata Discographer";

export function editGroupUrl(editGroup: string): string {
  return `https://editgroups.toolforge.org/b/CB/${editGroup}/`;
}

/**
 * A summary crediting the tool and linking its EditGroups batch. "CB" (custom
 * bot) is the generic tool id EditGroups tracks without registration; the link
 * text must be exactly "details".
 */
export function editSummary(text: string, editGroup: string): string {
  const tail = ` (${TOOL_CREDIT}) ([[:toolforge:editgroups/b/CB/${editGroup}|details]])`;
  const room = 400 - tail.length;
  const head =
    text.length <= room
      ? text
      : `${Array.from(text)
          .slice(0, room - 1)
          .join("")}…`;
  return head + tail;
}

const running = new Set<number>();

export const submissionRoutes = new Hono<AuthEnv>();

// A box set's form state is tens of KB; anything near this isn't a real album.
const MAX_BODY_BYTES = 1 << 20;

submissionRoutes.post(
  "/",
  requireUser,
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "That form is too big to submit." }, 413),
  }),
  async (c) => {
    const user = c.get("user")!;
    if (user.blocked) return c.json({ error: "Your account is blocked on Wikidata." }, 403);
    const eligibility = editEligibility(user);
    if (!eligibility.ok) return c.json({ error: eligibility.reason }, 403);
    if (running.has(user.id)) return c.json({ error: "You already have a run in progress." }, 409);
    // Held from here, so a double click can't start two runs during the checks.
    running.add(user.id);
    let started = false;
    try {
      const res = await startRun(c, user);
      started = res.status === 202;
      return res;
    } finally {
      if (!started) running.delete(user.id);
    }
  },
);

async function startRun(c: Context<AuthEnv>, user: AuthUser) {
  const body = (await c.req.json().catch(() => null)) as Partial<SubmissionRequest> | null;
  const state = coerceState(body?.state);
  const plan = buildPlan(state);
  if (!plan.ready) {
    const first = plan.messages.find((m) => m[0] === "err");
    return c.json({ error: first?.[1] ?? "Nothing to do." }, 422);
  }

  // The last run may have created an item it couldn't confirm. Go on only
  // once the form uses it, or the user says it wasn't created.
  const unknownRun = await checkUnknownRun(user);
  if (unknownRun) {
    const used = unknownRun.qid !== null && JSON.stringify(state).includes(`"${unknownRun.qid}"`);
    const confirmed = unknownRun.qid === null && body?.confirmUnknown === unknownRun.id;
    if (!used && !confirmed)
      return c.json(
        {
          error: unknownRun.qid
            ? `Your last run created ${unknownRun.what} after all, as ${unknownRun.qid}. Use it in the form before running again, so it isn't created twice.`
            : `Your last run may have created ${unknownRun.what}: Wikidata didn't answer, and it still can't be found. Check your contributions and the EditGroup, then confirm it wasn't created to run again.`,
          unknownRun,
        } satisfies UnknownRunConflict,
        409,
      );
  }

  // An identifier given for a new album that the mirror already has is a
  // duplicate for sure; title matches are only warned about in the form.
  if (state.album.mode === "create") {
    const given = ALBUM_ID_FIELDS.map(
      (f) => [f.property, state.album.ids[f.key].trim()] as const,
    ).filter(([, v]) => v);
    for (const [property, value] of given) {
      const [hit] = await db
        .select({ qid: musicExternalIds.qid })
        .from(musicExternalIds)
        .where(
          and(
            eq(musicExternalIds.property, propertyNumber(property)),
            eq(musicExternalIds.value, value),
          ),
        )
        .limit(1);
      if (hit)
        return c.json(
          {
            error: `${toQid(hit.qid)} already has ${ID_PROPERTIES[property]} ${value}; use that album instead.`,
          },
          409,
        );
    }
  }

  // Every item the run edits or links to must exist, or it would fail
  // partway, after creating the items before it.
  let problems: string[];
  try {
    problems = await checkPlanQids(plan.ops, state);
  } catch (err) {
    console.warn("checking the QIDs failed", err);
    return c.json(
      {
        error: `Couldn't check the QIDs on Wikidata (${err instanceof Error ? err.message : String(err)}). Try again in a minute.`,
      },
      503,
    );
  }
  if (problems.length > 0) return c.json({ error: problems.join(" ") }, 422);

  const editGroup = randomBytes(8).toString("hex");
  const [res] = await db.insert(submissions).values({
    userId: user.id,
    editGroup,
    status: "running",
    title: state.album.mode === "create" ? state.album.title.trim() : state.album.qid.trim(),
    // buildPlan has checked it's a QID.
    albumQid: state.album.mode === "create" ? null : qidNumber(state.album.qid.trim()),
    input: state,
  });
  const id = res.insertId;
  // The guard is only let go once the run's end is saved. Otherwise the DB
  // still says "running" and the form never got its QIDs, so another run of
  // the same form would create them again. It's held until the next boot's
  // markInterrupted.
  void runPlan(id, user, plan.ops, editGroup).then(
    (saved) => {
      if (saved) running.delete(user.id);
    },
    (err: unknown) => console.error(`submission ${id}: run failed`, err),
  );
  return c.json({ id }, 202);
}

submissionRoutes.get("/", requireUser, async (c) => {
  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.userId, c.get("user")!.id))
    .orderBy(desc(submissions.id))
    .limit(20);
  return c.json({
    submissions: rows.map((r) => ({
      id: r.id,
      status: r.status as SubmissionStatus,
      title: r.title,
      albumQid: r.albumQid == null ? null : toQid(r.albumQid),
      editGroupUrl: editGroupUrl(r.editGroup),
      error: r.error,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    })),
  } satisfies SubmissionListResponse);
});

submissionRoutes.get("/:id", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const [row] = Number.isInteger(id)
    ? await db
        .select()
        .from(submissions)
        .where(and(eq(submissions.id, id), eq(submissions.userId, c.get("user")!.id)))
    : [];
  if (!row) return c.json({ error: "Not found" }, 404);
  const edits = await db
    .select()
    .from(wikidataEdits)
    .where(eq(wikidataEdits.submissionId, id))
    .orderBy(wikidataEdits.id);
  c.header("Cache-Control", "no-store");
  const input = coerceState(row.input);
  return c.json({
    id: row.id,
    status: row.status as SubmissionStatus,
    title: row.title,
    albumQid: row.albumQid == null ? null : toQid(row.albumQid),
    editGroupUrl: editGroupUrl(row.editGroup),
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    total: buildPlan(input).ops.length,
    waitingUntil: waitingUntil(row.status, row.userId),
    edits: edits
      // A create still waiting on Wikidata's answer isn't in the log yet.
      .filter((e) => !(row.status === "running" && e.unknown && e.errorCode == null))
      .map((e): EditLogEntry => ({
        op: e.op as EditLogEntry["op"],
        key: e.key,
        kind: e.kind,
        what: e.what,
        qid: e.qid == null ? null : toQid(e.qid),
        revid: e.revid,
        ok: e.ok,
        unknown: e.unknown,
        skipped: e.skipped,
        error: e.errorText,
      })),
    input,
  } satisfies SubmissionInfo);
});

/** When a running run's next edit goes out, while it waits its turn (server/edit-pace.ts). */
function waitingUntil(status: string, userId: number): string | null {
  const at = status === "running" ? editPacer.waitingUntil(userId) : null;
  return at === null ? null : new Date(at).toISOString();
}

/**
 * On boot: runs still marked running were cut off by the restart. One that
 * was looking for an item a create may have made ends "unknown".
 */
export async function markInterrupted(): Promise<void> {
  const pending = await db
    .select({
      id: submissions.id,
      editId: wikidataEdits.id,
      errorCode: wikidataEdits.errorCode,
      what: wikidataEdits.what,
      key: wikidataEdits.key,
    })
    .from(submissions)
    .innerJoin(wikidataEdits, eq(wikidataEdits.submissionId, submissions.id))
    .where(
      and(
        eq(submissions.status, "running"),
        eq(wikidataEdits.unknown, true),
        eq(wikidataEdits.ok, false),
      ),
    );
  for (const p of pending) {
    // Cut off while Wikidata had the create, before any answer.
    if (p.errorCode == null)
      await db
        .update(wikidataEdits)
        .set({
          errorCode: "interrupted",
          errorText:
            "The server restarted while creating this, so it may have been created anyway.",
        })
        .where(eq(wikidataEdits.id, p.editId));
    await db
      .update(submissions)
      .set({
        status: "unknown",
        error: unknownMessage(p.what, p.key),
        finishedAt: toSqlDatetime(new Date()),
      })
      .where(eq(submissions.id, p.id));
  }
  await db
    .update(submissions)
    .set({
      status: "interrupted",
      error: "The server restarted during this run.",
      finishedAt: toSqlDatetime(new Date()),
    })
    .where(eq(submissions.status, "running"));
}

/** Where in the form a created item's QID goes, by its plan key. */
function fieldFor(key: string | null): string {
  const kind = key?.split(":")[0];
  if (kind === "album") return "the album's “Use an existing album” field";
  if (kind === "comp") return "the track's “Existing composition” field";
  if (kind === "track") return "the track's “Existing track” field";
  if (kind === "single") return "the track's “Single” field";
  return "the form";
}

export function unknownMessage(what: string, key: string | null): string {
  return `Wikidata didn't answer when creating ${what}, so it may have been created anyway. Check your contributions or the EditGroup before running again. If it was created, put its QID in ${fieldFor(key)}.`;
}

/** A create got no answer and its item couldn't be found: the run ends "unknown". */
class UnknownOutcome extends Error {}

type CreateOp = Extract<Op, { op: "create" }>;

async function createItem(
  editUser: EditUser,
  op: CreateOp,
  resolve: (key: string) => string,
  summary: string,
): Promise<Entity> {
  const body = await editRequest(
    editUser,
    {
      action: "wbeditentity",
      new: "item",
      data: JSON.stringify({
        labels: Object.fromEntries(
          Object.entries(op.labels).map(([l, v]) => [l, { language: l, value: v }]),
        ),
        descriptions: Object.fromEntries(
          Object.entries(op.descriptions).map(([l, v]) => [l, { language: l, value: v }]),
        ),
        claims: op.claims.map((cl) => toStatement(cl, resolve)),
      }),
      summary,
    },
    { timeoutMs: CREATE_TIMEOUT_MS },
  );
  const entity = body.entity as Entity | undefined;
  // A success without the item's id: it was probably saved, but which is it?
  if (!entity?.id)
    throw new WikidataEditError("unexpected-response", "Wikidata returned no item id", {
      ambiguous: true,
    });
  return entity;
}

/**
 * The user's last run, if it ended "unknown", with the item it may have
 * created looked for again (the replicas have caught up by now).
 */
async function checkUnknownRun(user: AuthUser): Promise<UnknownRunConflict["unknownRun"] | null> {
  const [last] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.userId, user.id))
    .orderBy(desc(submissions.id))
    .limit(1);
  if (last?.status !== "unknown") return null;
  const edits = await db
    .select()
    .from(wikidataEdits)
    .where(eq(wikidataEdits.submissionId, last.id))
    .orderBy(wikidataEdits.id);
  const pending = edits.findLast((e) => e.unknown);
  if (!pending) return null;
  let qid = pending.qid == null ? null : toQid(pending.qid);
  const op = buildPlan(coerceState(last.input)).ops.find(
    (o): o is CreateOp => o.op === "create" && o.key === pending.key,
  );
  if (!qid && op && pending.startedAt) {
    try {
      const found = await findCreated({
        username: user.username,
        summary: editSummary(`Create ${pending.what}`, last.editGroup),
        labels: op.labels,
        startedAt: fromSqlDatetime(pending.startedAt),
        exclude: new Set(edits.filter((e) => e.ok && e.qid != null).map((e) => toQid(e.qid!))),
      });
      if (found.length === 1) {
        const entity = found[0];
        qid = entity.id;
        await db
          .update(wikidataEdits)
          .set({ qid: qidNumber(qid), revid: entity.lastrevid ?? null })
          .where(eq(wikidataEdits.id, pending.id));
        if (pending.key === "album")
          await db
            .update(submissions)
            .set({ albumQid: qidNumber(qid) })
            .where(eq(submissions.id, last.id));
        const row = entityToRow(entity);
        if (row)
          await upsertRows([row], { source: "app" }).catch((e: unknown) =>
            console.error("mirror write failed", e),
          );
      }
    } catch (err) {
      // Wikidata is still struggling; the user can check by hand.
      console.warn(`submission ${last.id}: looking for ${pending.what} failed`, err);
    }
  }
  return {
    id: last.id,
    what: pending.what,
    key: pending.key,
    editGroupUrl: editGroupUrl(last.editGroup),
    qid,
  };
}

/** Execute the plan's operations in order as `user`. Stops at the first failure. */
export async function runPlan(
  submissionId: number,
  user: AuthUser,
  ops: readonly Op[],
  editGroup: string,
  { retryMs = [2_000, 10_000] }: { retryMs?: readonly number[] } = {},
): Promise<boolean> {
  const editUser: EditUser = { id: user.id, username: user.username };
  const created = new Map<string, string>();
  const resolve = (key: string) => {
    const qid = created.get(key);
    if (!qid) throw new Error(`No item was created for ${key}`);
    return qid;
  };
  const log = ({
    qid,
    ...values
  }: Omit<typeof wikidataEdits.$inferInsert, "submissionId" | "userId" | "qid"> & {
    qid?: string | null;
  }) =>
    db
      .insert(wikidataEdits)
      .values({ submissionId, userId: user.id, ...values, qid: qid ? qidNumber(qid) : null });

  let status: SubmissionStatus = "done";
  let error: string | null = null;
  for (const op of ops) {
    const what = describeOp(op);
    // A create's log row, until it's settled, and whether the item may exist.
    let pendingId: number | null = null;
    let mayExist = false;
    try {
      if (op.op === "create") {
        const summary = editSummary(`Create ${what}`, editGroup);
        const startedAt = new Date();
        let entity: Entity;
        // Log it as unknown before sending, so a restart before Wikidata
        // answers ends the run "unknown" (markInterrupted) rather than
        // inviting a rerun that would create it twice.
        const [res] = await log({
          op: "create",
          key: op.key,
          kind: op.kind,
          what,
          ok: false,
          unknown: true,
          startedAt: toSqlDatetime(startedAt),
        });
        pendingId = res.insertId;
        mayExist = true;
        try {
          entity = await createItem(editUser, op, resolve, summary);
        } catch (err) {
          if (!(err instanceof WikidataEditError && err.ambiguous)) {
            mayExist = false;
            throw err;
          }
          // It may have been saved, so it is never sent again.
          await db
            .update(wikidataEdits)
            .set({
              errorCode: err.code.slice(0, 64),
              errorText: `Wikidata didn't answer (${err.message}), so it may have been created anyway.`,
            })
            .where(eq(wikidataEdits.id, pendingId));
          const found = await waitForCreated(
            {
              username: user.username,
              summary,
              labels: op.labels,
              startedAt,
              exclude: new Set(created.values()),
            },
            new Date(),
          );
          if (found.length !== 1) {
            if (found.length > 1)
              await db
                .update(wikidataEdits)
                .set({
                  errorText: `Wikidata didn't answer, and ${found.length} items match it: ${found.map((e) => e.id).join(", ")}.`,
                })
                .where(eq(wikidataEdits.id, pendingId));
            throw new UnknownOutcome(unknownMessage(what, op.key));
          }
          entity = found[0];
        }
        created.set(op.key, entity.id);
        // Settled. If it was found after no answer, `error_code` keeps what went wrong.
        await db
          .update(wikidataEdits)
          .set({
            ok: true,
            unknown: false,
            qid: qidNumber(entity.id),
            revid: entity.lastrevid ?? null,
            errorText: null,
          })
          .where(eq(wikidataEdits.id, pendingId));
        pendingId = null;
        if (op.key === "album")
          await db
            .update(submissions)
            .set({ albumQid: qidNumber(entity.id) })
            .where(eq(submissions.id, submissionId));
        // Add it to the mirror now, so duplicate checks see it before the next dump.
        const row = entityToRow(entity);
        if (row)
          await upsertRows([row], { source: "app" }).catch((e: unknown) =>
            console.error("mirror write failed", e),
          );
      } else {
        const qid = "id" in op.target ? op.target.id : resolve(op.target.ref);
        // Skip statements the item already has, so re-running a run, or
        // reusing existing items, doesn't add duplicates.
        const entity = (await getEntities([qid])).get(qid);
        if (!entity)
          throw new WikidataEditError("missing", `${qid} doesn't exist (or is a redirect)`);
        const fresh = freshStatements(entity.claims ?? {}, op.claims, resolve);
        const skipped = op.claims.length - fresh.length;
        if (fresh.length === 0) {
          await log({ op: "addClaims", what, qid, ok: true, skipped });
          continue;
        }
        const body = await editRequest(editUser, {
          action: "wbeditentity",
          id: qid,
          baserevid: String(entity.lastrevid ?? ""),
          data: JSON.stringify({ claims: fresh }),
          summary: editSummary(what, editGroup),
        });
        const revid = (body.entity as { lastrevid?: number } | undefined)?.lastrevid ?? null;
        await log({ op: "addClaims", what, qid, revid, ok: true, skipped });
        // Refresh its mirror row (e.g. a reused track's new P2550) from the
        // saved entity Wikidata sends back, so matches see it before the next dump.
        const row = body.entity
          ? entityToRow({ ...(body.entity as object), id: qid } as Parameters<
              typeof entityToRow
            >[0])
          : null;
        if (row)
          await upsertRows([row], { source: "app" }).catch((e: unknown) =>
            console.error("mirror write failed", e),
          );
      }
    } catch (err) {
      if (err instanceof UnknownOutcome) {
        status = "unknown";
        error = err.message;
        break;
      }
      // The create may have been saved but its row isn't settled (e.g. the
      // search after no answer failed): its pending row keeps a rerun from
      // sending it again.
      if (op.op === "create" && mayExist && pendingId !== null) {
        console.error(`submission ${submissionId}: ${what} failed`, err);
        status = "unknown";
        error = unknownMessage(what, op.key);
        break;
      }
      const code = err instanceof WikidataEditError ? err.code : "internal";
      const text = err instanceof Error ? err.message : String(err);
      if (!(err instanceof WikidataEditError))
        console.error(`submission ${submissionId}: ${what} failed`, err);
      const failure = { ok: false, errorCode: code.slice(0, 64), errorText: text };
      // Wikidata refused the create: its pending row becomes the failure.
      await (
        pendingId !== null
          ? db
              .update(wikidataEdits)
              .set({ ...failure, unknown: false })
              .where(eq(wikidataEdits.id, pendingId))
          : log({
              op: op.op,
              key: op.op === "create" ? op.key : null,
              kind: op.op === "create" ? op.kind : null,
              what,
              ...failure,
            })
      ).catch(() => {});
      status = "failed";
      error = `${what}: ${text}`;
      break;
    }
  }
  // Whether the run's end was saved. If not, it stays "running" until the
  // next boot's markInterrupted.
  for (let attempt = 0; ; attempt++) {
    try {
      await db
        .update(submissions)
        .set({ status, error, finishedAt: toSqlDatetime(new Date()) })
        .where(eq(submissions.id, submissionId));
      return true;
    } catch (err) {
      console.error(`submission ${submissionId}: status write failed`, err);
      if (attempt >= retryMs.length) return false;
      await new Promise((r) => setTimeout(r, retryMs[attempt]));
    }
  }
}
