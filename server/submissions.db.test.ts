// The unknown-run guard in POST /api/submissions, against a real MariaDB. Only
// runs with DB_TESTS=1, as it writes to the DB the DB_* variables point at
// (and only rows of its own made-up user). That DB's name has to end in _test,
// so a .env pointing at a dev or ToolsDB DB can't be written to by mistake.
// CI runs it in the db job.
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, pool } from "./db.ts";
import { submissions, users, wikidataEdits } from "../db/schema.ts";
import { submissionRoutes } from "./submissions.ts";
import type { State } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";
import { EXAMPLE } from "../src/lib/example.fixture.ts";

if (process.env.DB_TESTS && !process.env.DB_NAME?.endsWith("_test"))
  throw new Error(
    `DB_TESTS writes to the DB, so DB_NAME has to end in _test (it's ${process.env.DB_NAME ?? "unset, so discographer"}).`,
  );

const USER = vi.hoisted(() => ({
  id: 990000165,
  username: "Unknown run test",
  editCount: 1000,
  registeredAt: "2020-01-01 00:00:00",
}));

vi.mock("./auth/session.ts", () => ({
  requireUser: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", USER);
    await next();
  },
  markBlocked: async () => {},
}));
vi.mock("./auth/eligibility.ts", () => ({ editEligibility: () => ({ ok: true }) }));
// A run that gets past the guards stops at the QID check, so it never starts.
vi.mock("./check-qids.ts", () => ({ checkPlanQids: async () => ["Past the guards."] }));
vi.mock("./recover.ts", () => ({ findCreated: async () => [], waitForCreated: async () => [] }));
vi.mock("./wikidata-client.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  editRequest: async () => {
    throw new Error("No edits from tests");
  },
  getEntities: async () => {
    throw new Error("No Wikidata reads from tests");
  },
}));

const app = new Hono().route("/api/submissions", submissionRoutes);

async function post(body: { state: State; confirmUnknown?: number }) {
  const res = await app.request("/api/submissions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const json = (await res.json()) as { error: string; unknownRun?: { qid: string | null } };
  return { status: res.status, ...json };
}

/** EXAMPLE as a new album called `title`, with no external IDs. */
function newAlbum(title: string): State {
  const s = coerceState(structuredClone(EXAMPLE));
  s.album.mode = "create";
  s.album.qid = "";
  s.album.title = title;
  return s;
}

async function clear() {
  await db.delete(wikidataEdits).where(eq(wikidataEdits.userId, USER.id));
  await db.delete(submissions).where(eq(submissions.userId, USER.id));
  await db.delete(users).where(eq(users.id, USER.id));
}

/** A last run of "Day and Night" that ended "unknown" over its album, found as `qid` or not. */
async function unknownRun(qid: number | null): Promise<number> {
  await db.insert(users).values({ id: USER.id, username: USER.username });
  const [res] = await db.insert(submissions).values({
    userId: USER.id,
    editGroup: "0123456789abcdef",
    status: "unknown",
    title: "Day and Night",
    input: newAlbum("Day and Night"),
  });
  await db.insert(wikidataEdits).values({
    submissionId: res.insertId,
    userId: USER.id,
    op: "create",
    key: "album",
    kind: "album",
    what: "album “Day and Night”",
    ok: false,
    unknown: true,
    qid,
    startedAt: "2026-10-01 00:00:00",
    errorCode: "network",
  });
  return res.insertId;
}

describe.skipIf(!process.env.DB_TESTS)("the unknown-run guard", () => {
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await pool.end();
  });

  describe("once the item is found", () => {
    it("holds up the same form, which would create it again", async () => {
      await unknownRun(123456);
      const res = await post({ state: newAlbum("Day and Night") });
      expect(res.status).toBe(409);
      expect(res.unknownRun?.qid).toBe("Q123456");
    });

    it("lets another album's form go on", async () => {
      await unknownRun(123456);
      const res = await post({ state: newAlbum("Emotion") });
      expect(res.error).toBe("Past the guards.");
    });

    it("lets a form that uses the item go on", async () => {
      await unknownRun(123456);
      const s = coerceState(structuredClone(EXAMPLE));
      s.album.qid = "Q123456";
      const res = await post({ state: s });
      expect(res.error).toBe("Past the guards.");
    });

    it("lets the same form go on once the user says the item was deleted", async () => {
      const id = await unknownRun(123456);
      const res = await post({ state: newAlbum("Day and Night"), confirmUnknown: id });
      expect(res.error).toBe("Past the guards.");
    });
  });

  describe("while the item can't be found", () => {
    it("holds up any form until the user confirms it wasn't created", async () => {
      const id = await unknownRun(null);
      const other = await post({ state: newAlbum("Emotion") });
      expect(other.status).toBe(409);
      expect(other.unknownRun?.qid).toBeNull();
      const confirmed = await post({ state: newAlbum("Emotion"), confirmUnknown: id });
      expect(confirmed.error).toBe("Past the guards.");
    });
  });
});
