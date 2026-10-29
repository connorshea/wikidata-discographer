// The unknown-run guard in POST /api/submissions, against a real MariaDB. Only
// runs with DB_TESTS=1, as it writes to the DB the DB_* variables point at
// (and only rows of its own made-up user). That DB's name has to end in _test,
// so a .env pointing at a dev or ToolsDB DB can't be written to by mistake.
// CI runs it in the db job.
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db.ts";
import {
  musicExternalIds,
  musicItems,
  musicLinks,
  submissions,
  users,
  wikidataEdits,
} from "../db/schema.ts";
import { runPlan, submissionRoutes } from "./submissions.ts";
import type { Entity, WikibaseStatement } from "./wikidata-client.ts";
import { type Op, SINGLE_CLASS, type State } from "../src/lib/plan.ts";
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

/** What Wikidata says about the found item when the user says it was deleted. */
const FOUND = vi.hoisted(() => ({
  check: { status: "missing" } as { status: "ok" | "missing" } | { status: "redirect"; to: string },
}));

/**
 * Wikidata for runPlan: the album it reads and edits, and whether an edit is saved
 * but its answer lost. Reads and edits throw while there's no album.
 */
const WIKIDATA = vi.hoisted(() => ({ album: null as Entity | null, answerLost: false }));

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
  // Like Wikidata, the answer has only the statements sent.
  editRequest: async (_user: unknown, params: { id: string; data: string }) => {
    const album = WIKIDATA.album;
    if (!album) throw new Error("No edits from tests");
    const { claims } = JSON.parse(params.data) as { claims: WikibaseStatement[] };
    for (const c of claims)
      (album.claims![c.mainsnak.property] ??= []).push({ ...c, rank: c.rank ?? "normal" });
    album.lastrevid = (album.lastrevid ?? 0) + 1;
    if (WIKIDATA.answerLost) throw new Error("socket hang up");
    return {
      entity: {
        id: params.id,
        lastrevid: album.lastrevid,
        claims: Object.groupBy(claims, (c) => c.mainsnak.property),
      },
    };
  },
  getEntities: async (qids: string[]) => {
    const album = WIKIDATA.album;
    if (!album) throw new Error("No Wikidata reads from tests");
    return new Map(qids.includes(album.id) ? [[album.id, structuredClone(album)]] : []);
  },
  checkItems: async (qids: string[]) => new Map(qids.map((q) => [q, FOUND.check])),
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

/** An album in the mirror with a Spotify album ID, for the duplicate-ID check. */
const TAKEN = { qid: 990000166, spotify: "0123456789abcdefABCDEF" };

/** A run's album in the mirror, with one performer that has a label and one that isn't mirrored. */
const RUN_ALBUM = { qid: 990000167, artist: 990000168, unmirrored: 990000169 };

if (process.env.DB_TESTS) afterAll(() => pool.end());

async function clear() {
  await db.delete(musicExternalIds).where(eq(musicExternalIds.qid, TAKEN.qid));
  await db.delete(musicLinks).where(eq(musicLinks.qid, RUN_ALBUM.qid));
  await db
    .delete(musicItems)
    .where(inArray(musicItems.qid, [TAKEN.qid, RUN_ALBUM.qid, RUN_ALBUM.artist]));
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
  afterAll(clear);

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

    it("lets the same form go on once the user says the item was deleted, and it was", async () => {
      const id = await unknownRun(123456);
      FOUND.check = { status: "missing" };
      const res = await post({ state: newAlbum("Day and Night"), confirmUnknown: id });
      expect(res.error).toBe("Past the guards.");
    });

    it("still holds up the same form if the user says it was deleted, but it wasn't", async () => {
      const id = await unknownRun(123456);
      FOUND.check = { status: "ok" };
      const res = await post({ state: newAlbum("Day and Night"), confirmUnknown: id });
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/Q123456 hasn't been deleted/);
    });

    it("points at the item it was merged into, if it was", async () => {
      const id = await unknownRun(123456);
      FOUND.check = { status: "redirect", to: "Q654321" };
      const res = await post({ state: newAlbum("Day and Night"), confirmUnknown: id });
      expect(res.status).toBe(409);
      expect(res.error).toMatch(/merged into Q654321/);
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

describe.skipIf(!process.env.DB_TESTS)("the duplicate-ID check", () => {
  beforeEach(clear);
  afterAll(clear);

  it("names the kind of the item that has the ID, not the form's", async () => {
    await db
      .insert(musicItems)
      .values({ qid: TAKEN.qid, kind: "album", label: "Ocean Eyes", instanceOf: [] });
    await db
      .insert(musicExternalIds)
      .values({ qid: TAKEN.qid, property: 2205, value: TAKEN.spotify });
    const s = newAlbum("Fireflies");
    s.album.type = SINGLE_CLASS;
    s.album.ids.spotify = TAKEN.spotify;
    const res = await post({ state: s });
    expect(res.status).toBe(409);
    expect(res.error).toBe(
      `Q${TAKEN.qid} already has Spotify album ID ${TAKEN.spotify}. Use that album instead.`,
    );
  });
});

describe.skipIf(!process.env.DB_TESTS)("a run's artists", () => {
  beforeEach(clear);
  afterAll(clear);

  /** A run on the existing RUN_ALBUM that ended `status`. */
  async function run(status: string): Promise<number> {
    await db.insert(users).values({ id: USER.id, username: USER.username });
    const input = coerceState(structuredClone(EXAMPLE));
    input.album.mode = "existing";
    input.album.qid = `Q${RUN_ALBUM.qid}`;
    const [res] = await db.insert(submissions).values({
      userId: USER.id,
      editGroup: "0123456789abcdef",
      status,
      title: `Q${RUN_ALBUM.qid}`,
      albumQid: RUN_ALBUM.qid,
      input,
    });
    return res.insertId;
  }

  async function artists(id: number) {
    const res = await app.request(`/api/submissions/${id}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { artists: unknown }).artists;
  }

  beforeEach(async () => {
    await db.insert(musicItems).values([
      { qid: RUN_ALBUM.qid, kind: "album", label: "Homogenic", instanceOf: [] },
      { qid: RUN_ALBUM.artist, kind: "artist", label: "Björk", instanceOf: [] },
    ]);
    await db.insert(musicLinks).values(
      [RUN_ALBUM.artist, RUN_ALBUM.unmirrored].map((target) => ({
        qid: RUN_ALBUM.qid,
        property: 175,
        target,
      })),
    );
  });

  it("lists the album's performers in the mirror once the run is done", async () => {
    expect(await artists(await run("done"))).toEqual([
      { qid: `Q${RUN_ALBUM.artist}`, label: "Björk" },
      { qid: `Q${RUN_ALBUM.unmirrored}`, label: `Q${RUN_ALBUM.unmirrored}` },
    ]);
  });

  it("lists none while the run goes, or when it failed", async () => {
    expect(await artists(await run("running"))).toEqual([]);
    await clear();
    expect(await artists(await run("failed"))).toEqual([]);
  });
});

describe.skipIf(!process.env.DB_TESTS)("the album's mirror row after a run", () => {
  const ALBUM = `Q${RUN_ALBUM.qid}`;
  const TRACK = 990000170;

  beforeEach(async () => {
    await clear();
    await db.insert(users).values({ id: USER.id, username: USER.username });
    // The mirror has the album as of the last dump, with no tracklist.
    await db
      .insert(musicItems)
      .values({ qid: RUN_ALBUM.qid, kind: "album", label: "Homogenic", instanceOf: [], revid: 1 });
    WIKIDATA.album = {
      id: ALBUM,
      lastrevid: 1,
      labels: { en: { language: "en", value: "Homogenic" } },
      claims: {
        P31: [
          {
            mainsnak: {
              snaktype: "value",
              property: "P31",
              datavalue: { type: "wikibase-entityid", value: { id: "Q482994" } },
            },
            rank: "normal",
          },
        ],
      },
    };
    WIKIDATA.answerLost = false;
  });
  afterAll(async () => {
    WIKIDATA.album = null;
    await clear();
  });

  async function runTracklist(albumQid: string | null = ALBUM): Promise<number> {
    const [res] = await db.insert(submissions).values({
      userId: USER.id,
      editGroup: "0123456789abcdef",
      status: "running",
      title: ALBUM,
      albumQid: RUN_ALBUM.qid,
      input: newAlbum("Homogenic"),
    });
    const ops: Op[] = [
      {
        op: "addClaims",
        target: { id: ALBUM },
        what: "album tracklist",
        claims: [{ property: "P658", value: { type: "item", id: `Q${TRACK}` } }],
      },
    ];
    expect(await runPlan(res.insertId, USER, ops, "0123456789abcdef", albumQid)).toBe(true);
    return res.insertId;
  }

  async function mirrored() {
    const [row] = await db.select().from(musicItems).where(eq(musicItems.qid, RUN_ALBUM.qid));
    const links = await db.select().from(musicLinks).where(eq(musicLinks.qid, RUN_ALBUM.qid));
    return { label: row.label, revid: row.revid, links: links.map((l) => [l.property, l.target]) };
  }

  it("has the tracklist the run added", async () => {
    const id = await runTracklist();
    expect(await mirrored()).toEqual({ label: "Homogenic", revid: 2, links: [[658, TRACK]] });
    const [run] = await db.select().from(submissions).where(eq(submissions.id, id));
    expect(run.status).toBe("done");
  });

  it("has what an edit to any other item adds, without reading it again", async () => {
    // As no album is given, nothing reads it again after the run.
    await runTracklist(null);
    expect(await mirrored()).toEqual({ label: "Homogenic", revid: 2, links: [[658, TRACK]] });
  });

  it("has it after a failed run too, as the edit may have been saved", async () => {
    WIKIDATA.answerLost = true;
    const id = await runTracklist();
    const [run] = await db.select().from(submissions).where(eq(submissions.id, id));
    expect(run.status).toBe("failed");
    expect(await mirrored()).toEqual({ label: "Homogenic", revid: 2, links: [[658, TRACK]] });
  });
});
