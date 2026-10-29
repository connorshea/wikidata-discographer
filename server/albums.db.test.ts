// GET /api/albums against a real MariaDB. Only runs with DB_TESTS=1, as it
// writes to the DB the DB_* variables point at (and only rows of its own
// made-up users and QIDs). That DB's name has to end in _test, so a .env
// pointing at a dev or ToolsDB DB can't be written to by mistake. CI runs it in
// the db job.
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, pool } from "./db.ts";
import { musicItems, submissions, users, wikidataEdits } from "../db/schema.ts";
import { albumRoutes } from "./albums.ts";
import type { AuthEnv } from "./auth/session.ts";
import { SINGLE_CLASS } from "../src/lib/plan.ts";
import type { AlbumListResponse } from "../src/lib/api-types.ts";

if (process.env.DB_TESTS && !process.env.DB_NAME?.endsWith("_test"))
  throw new Error(
    `DB_TESTS writes to the DB, so DB_NAME has to end in _test (it's ${process.env.DB_NAME ?? "unset, so discographer"}).`,
  );

const USER = 990000254;
const OTHER = 990000255;
const USERS = [USER, OTHER];

// Made-up QIDs, well past any real item's.
const BASE = 990_000_254_000;
const ALBUM_A = BASE;
const ALBUM_B = BASE + 1;
const ALBUM_C = BASE + 2;
const QIDS = [ALBUM_A, ALBUM_B, ALBUM_C];

const app = new Hono<AuthEnv>()
  .use(async (c, next) => {
    if (c.req.header("x-user")) c.set("user", { id: USER } as AuthEnv["Variables"]["user"]);
    await next();
  })
  .route("/api/albums", albumRoutes);

async function clear() {
  await db.delete(wikidataEdits).where(inArray(wikidataEdits.userId, USERS));
  await db.delete(submissions).where(inArray(submissions.userId, USERS));
  await db.delete(users).where(inArray(users.id, USERS));
  await db.delete(musicItems).where(inArray(musicItems.qid, QIDS));
}

async function run(userId: number, albumQid: number, title: string, input: unknown = {}) {
  const [{ id }] = await db
    .insert(submissions)
    .values({ userId, editGroup: `g${title}`, status: "done", title, albumQid, input })
    .$returningId();
  return id;
}

/** The test's own albums on a page, as [QID, run ids]. */
async function list(query: string, loggedIn = false) {
  const res = await app.request(`/api/albums${query}`, {
    headers: loggedIn ? { "x-user": "1" } : {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as AlbumListResponse;
  return body.albums.filter((a) => QIDS.map((q) => `Q${q}`).includes(a.qid));
}

describe.skipIf(!process.env.DB_TESTS)("GET /api/albums", () => {
  let runs: number[];

  beforeEach(async () => {
    await clear();
    await db.insert(users).values([
      { id: USER, username: "Album list test" },
      { id: OTHER, username: "Album list other" },
    ]);
    await db.insert(musicItems).values({ qid: ALBUM_A, kind: "ep", label: "EP A", instanceOf: [] });
    runs = [
      await run(USER, ALBUM_A, "A 1"),
      await run(USER, ALBUM_B, "B 1", { album: { mode: "create", type: SINGLE_CLASS } }),
      await run(OTHER, ALBUM_A, "A 2"),
      await run(OTHER, ALBUM_C, "C 1"),
    ];
    const edit = { submissionId: runs[0], userId: USER, what: "x" };
    await db.insert(wikidataEdits).values([
      { ...edit, op: "create", key: "album", qid: BASE + 100, ok: true },
      { ...edit, op: "create", key: "track:0:0", qid: BASE + 101, ok: true },
      { ...edit, op: "create", key: "track:0:1", ok: false },
      { ...edit, op: "create", key: "track:0:2", qid: BASE + 102, ok: false, unknown: true },
      { ...edit, op: "addClaims", ok: true },
      { submissionId: runs[2], userId: OTHER, what: "x", op: "addClaims", ok: true },
    ]);
  });

  afterAll(async () => {
    await clear();
    await pool.end();
  });

  it("lists albums by their latest run, with what each run created", async () => {
    const albums = await list(`?before=${runs[3] + 1}`);
    expect(albums.map((a) => [a.qid, a.runs.map((r) => r.id)])).toEqual([
      [`Q${ALBUM_C}`, [runs[3]]],
      [`Q${ALBUM_A}`, [runs[2], runs[0]]],
      [`Q${ALBUM_B}`, [runs[1]]],
    ]);
    const [, a, b] = albums;
    expect(a).toMatchObject({ label: "EP A", type: "EP", created: true });
    expect(a.runs.map((r) => [r.created, r.createdAlbum])).toEqual([
      [0, false],
      [3, true],
    ]);
    expect(b).toMatchObject({ label: "B 1", type: "Single", created: false });
  });

  it("pages by the latest run, leaving out an album with a newer one", async () => {
    const albums = await list(`?before=${runs[2]}`);
    expect(albums.map((a) => a.qid)).toEqual([`Q${ALBUM_B}`]);
  });

  it("keeps the albums the user has a run on, with everyone's runs", async () => {
    const albums = await list(`?mine=1&before=${runs[3] + 1}`, true);
    expect(albums.map((a) => [a.qid, a.runs.map((r) => r.id)])).toEqual([
      [`Q${ALBUM_A}`, [runs[2], runs[0]]],
      [`Q${ALBUM_B}`, [runs[1]]],
    ]);
  });
});
