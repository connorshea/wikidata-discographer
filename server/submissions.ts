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
// ones it cut off as "interrupted" (see markInterrupted), and the client has
// already been told which items were created, so it can reuse them on a retry.
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db.ts";
import { musicExternalIds, submissions, wikidataEdits } from "../db/schema.ts";
import { type AuthEnv, type AuthUser, requireUser } from "./auth/session.ts";
import { toSqlDatetime } from "./auth/time.ts";
import { entityToRow, upsertRows } from "./mirror.ts";
import {
  editRequest,
  type EditUser,
  getEntities,
  toStatement,
  valueKey,
  WikidataEditError,
} from "./wikidata-client.ts";
import { buildPlan, type Op } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";
import { ALBUM_ID_FIELDS, ID_PROPERTIES } from "../src/lib/music.ts";
import type {
  EditLogEntry,
  SubmissionInfo,
  SubmissionListResponse,
  SubmissionStatus,
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
    if (running.has(user.id)) return c.json({ error: "You already have a run in progress." }, 409);

    const body = (await c.req.json().catch(() => null)) as { state?: unknown } | null;
    const state = coerceState(body?.state);
    const plan = buildPlan(state);
    if (!plan.ready) {
      const first = plan.messages.find((m) => m[0] === "err");
      return c.json({ error: first?.[1] ?? "Nothing to do." }, 422);
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
          .where(and(eq(musicExternalIds.property, property), eq(musicExternalIds.value, value)))
          .limit(1);
        if (hit)
          return c.json(
            {
              error: `${hit.qid} already has ${ID_PROPERTIES[property]} ${value}; use that album instead.`,
            },
            409,
          );
      }
    }

    const editGroup = randomBytes(8).toString("hex");
    const [res] = await db.insert(submissions).values({
      userId: user.id,
      editGroup,
      status: "running",
      title: state.album.mode === "create" ? state.album.title.trim() : state.album.qid.trim(),
      albumQid: state.album.mode === "create" ? null : state.album.qid.trim(),
      input: state,
    });
    const id = res.insertId;
    running.add(user.id);
    void runPlan(id, user, plan.ops, editGroup).finally(() => running.delete(user.id));
    return c.json({ id }, 202);
  },
);

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
      albumQid: r.albumQid,
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
  return c.json({
    id: row.id,
    status: row.status as SubmissionStatus,
    title: row.title,
    albumQid: row.albumQid,
    editGroupUrl: editGroupUrl(row.editGroup),
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    total: buildPlan(coerceState(row.input)).ops.length,
    edits: edits.map((e): EditLogEntry => ({
      op: e.op as EditLogEntry["op"],
      key: e.key,
      kind: e.kind,
      what: e.what,
      qid: e.qid,
      revid: e.revid,
      ok: e.ok,
      skipped: e.skipped,
      error: e.errorText,
    })),
  } satisfies SubmissionInfo);
});

/** On boot: runs still marked running were cut off by the restart. */
export async function markInterrupted(): Promise<void> {
  await db
    .update(submissions)
    .set({
      status: "interrupted",
      error: "The server restarted during this run.",
      finishedAt: toSqlDatetime(new Date()),
    })
    .where(eq(submissions.status, "running"));
}

function describe(op: Op): string {
  if (op.op === "addClaims") return `Add ${op.claims.length} statement(s) to ${op.what}`;
  const label = Object.values(op.labels)[0] ?? "";
  const kind = { album: "album", ep: "EP", single: "single", work: "composition", track: "track" }[
    op.kind as string
  ];
  return `${kind ?? "item"} “${label}”`;
}

/** Execute the plan's operations in order as `user`. Stops at the first failure. */
export async function runPlan(
  submissionId: number,
  user: AuthUser,
  ops: readonly Op[],
  editGroup: string,
): Promise<void> {
  const editUser: EditUser = { id: user.id, username: user.username };
  const created = new Map<string, string>();
  const resolve = (key: string) => {
    const qid = created.get(key);
    if (!qid) throw new Error(`No item was created for ${key}`);
    return qid;
  };
  const log = (values: Omit<typeof wikidataEdits.$inferInsert, "submissionId" | "userId">) =>
    db.insert(wikidataEdits).values({ submissionId, userId: user.id, ...values });

  let status: SubmissionStatus = "done";
  let error: string | null = null;
  for (const op of ops) {
    const what = describe(op);
    try {
      if (op.op === "create") {
        const body = await editRequest(editUser, {
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
          summary: editSummary(`Create ${what}`, editGroup),
        });
        const entity = body.entity as { id?: string; lastrevid?: number } | undefined;
        if (!entity?.id)
          throw new WikidataEditError("unexpected-response", "Wikidata returned no item id");
        created.set(op.key, entity.id);
        await log({
          op: "create",
          key: op.key,
          kind: op.kind,
          what,
          qid: entity.id,
          revid: entity.lastrevid ?? null,
          ok: true,
        });
        if (op.key === "album")
          await db
            .update(submissions)
            .set({ albumQid: entity.id })
            .where(eq(submissions.id, submissionId));
        // Add it to the mirror now, so duplicate checks see it before the next dump.
        const row = entityToRow({ ...(body.entity as object), id: entity.id } as Parameters<
          typeof entityToRow
        >[0]);
        if (row)
          await upsertRows([row], { lastDump: null, source: "app" }).catch((e: unknown) =>
            console.error("mirror write failed", e),
          );
      } else {
        const qid = "id" in op.target ? op.target.id : resolve(op.target.ref);
        // Skip statements the item already has (same property and value), so
        // re-running a run, or reusing existing items, doesn't add duplicates.
        const entity = (await getEntities([qid])).get(qid);
        if (!entity)
          throw new WikidataEditError("missing", `${qid} doesn't exist (or is a redirect)`);
        const have = new Set(
          Object.values(entity.claims ?? {})
            .flat()
            .map((s) => `${s.mainsnak.property}=${valueKey(s.mainsnak.datavalue)}`),
        );
        const statements = op.claims.map((cl) => toStatement(cl, resolve));
        const fresh = statements.filter(
          (s) => !have.has(`${s.mainsnak.property}=${valueKey(s.mainsnak.datavalue)}`),
        );
        const skipped = statements.length - fresh.length;
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
          await upsertRows([row], { lastDump: null, source: "app" }).catch((e: unknown) =>
            console.error("mirror write failed", e),
          );
      }
    } catch (err) {
      const code = err instanceof WikidataEditError ? err.code : "internal";
      const text = err instanceof Error ? err.message : String(err);
      if (!(err instanceof WikidataEditError))
        console.error(`submission ${submissionId}: ${what} failed`, err);
      await log({
        op: op.op,
        key: op.op === "create" ? op.key : null,
        kind: op.op === "create" ? op.kind : null,
        what,
        ok: false,
        errorCode: code.slice(0, 64),
        errorText: text,
      }).catch(() => {});
      status = "failed";
      error = `${what}: ${text}`;
      break;
    }
  }
  await db
    .update(submissions)
    .set({ status, error, finishedAt: toSqlDatetime(new Date()) })
    .where(eq(submissions.id, submissionId));
}
