// GET /api/artists/:qid against a real MariaDB. Only runs with DB_TESTS=1, as
// it writes to the DB the DB_* variables point at (and only mirror rows with
// its own made-up QIDs). That DB's name has to end in _test, so a .env pointing
// at a dev or ToolsDB DB can't be written to by mistake. CI runs it in the db job.
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, pool } from "./db.ts";
import { propertyNumber } from "./ids.ts";
import { musicExternalIds, musicItems, musicLinks } from "../db/schema.ts";
import { artistRoutes } from "./artists.ts";
import type { ArtistResponse } from "../src/lib/api-types.ts";

if (process.env.DB_TESTS && !process.env.DB_NAME?.endsWith("_test"))
  throw new Error(
    `DB_TESTS writes to the DB, so DB_NAME has to end in _test (it's ${process.env.DB_NAME ?? "unset, so discographer"}).`,
  );

vi.mock("./wikidata-client.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  describeItems: async () => {
    throw new Error("No Wikidata reads from tests");
  },
}));

const app = new Hono().route("/api/artists", artistRoutes);

// Made-up QIDs, well past any real item's.
const BASE = 990_000_192_000;
const ARTIST = BASE;
const OTHER_ARTIST = BASE + 1;
const ALBUM = BASE + 10;
const OTHERS_ALBUM = BASE + 11;
const SINGLE = BASE + 20;
const STANDALONE = BASE + 21;
const QIDS = [ARTIST, OTHER_ARTIST, ALBUM, OTHERS_ALBUM, SINGLE, STANDALONE];

const P175 = propertyNumber("P175");
const P434 = propertyNumber("P434");
const P658 = propertyNumber("P658");
const P13602 = propertyNumber("P13602");

async function clear() {
  await db.delete(musicExternalIds).where(inArray(musicExternalIds.qid, QIDS));
  await db.delete(musicLinks).where(inArray(musicLinks.qid, QIDS));
  await db.delete(musicItems).where(inArray(musicItems.qid, QIDS));
}

function item(qid: number, kind: string, label: string, released: string | null = null) {
  return { qid, kind, label, instanceOf: [], released };
}

async function get(qid: number): Promise<ArtistResponse> {
  const res = await app.request(`/api/artists/Q${qid}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ArtistResponse;
}

describe.skipIf(!process.env.DB_TESTS)("GET /api/artists/:qid", () => {
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await pool.end();
  });

  it("lists the artist's singles with their tracks and the albums they're taken from", async () => {
    await db
      .insert(musicItems)
      .values([
        item(ARTIST, "artist", "Owl City"),
        item(OTHER_ARTIST, "artist", "Carly Rae Jepsen"),
        item(ALBUM, "album", "Ocean Eyes", "2009-07-14"),
        item(OTHERS_ALBUM, "album", "Kiss", "2012-09-14"),
        item(SINGLE, "single", "Good Time", "2012-06-26"),
        item(STANDALONE, "single", "Fireflies", "2009-03-17"),
      ]);
    await db.insert(musicLinks).values([
      { qid: ALBUM, property: P175, target: ARTIST },
      { qid: OTHERS_ALBUM, property: P175, target: OTHER_ARTIST },
      { qid: SINGLE, property: P175, target: ARTIST },
      { qid: SINGLE, property: P175, target: OTHER_ARTIST },
      { qid: SINGLE, property: P13602, target: ALBUM },
      { qid: SINGLE, property: P13602, target: OTHERS_ALBUM },
      { qid: SINGLE, property: P658, target: BASE + 30 },
      { qid: SINGLE, property: P658, target: BASE + 31 },
      { qid: STANDALONE, property: P175, target: ARTIST },
    ]);
    const res = await get(ARTIST);
    expect(res.albums.map((a) => a.label)).toEqual(["Ocean Eyes"]);
    expect(res.singles).toEqual([
      {
        qid: `Q${STANDALONE}`,
        label: "Fireflies",
        released: "2009-03-17",
        tracks: 0,
        parts: null,
        takenFrom: [],
        releaseGroups: [],
        run: null,
      },
      {
        qid: `Q${SINGLE}`,
        label: "Good Time",
        released: "2012-06-26",
        tracks: 2,
        parts: null,
        takenFrom: [
          { qid: `Q${OTHERS_ALBUM}`, label: "Kiss" },
          { qid: `Q${ALBUM}`, label: "Ocean Eyes" },
        ],
        releaseGroups: [],
        run: null,
      },
    ]);
    expect(res.singlesTruncated).toBe(false);
  });

  it("has no singles for an artist with none", async () => {
    await db
      .insert(musicItems)
      .values([item(ARTIST, "artist", "Owl City"), item(ALBUM, "album", "Ocean Eyes", "2009")]);
    await db.insert(musicLinks).values([{ qid: ALBUM, property: P175, target: ARTIST }]);
    const res = await get(ARTIST);
    expect(res.albums.map((a) => a.label)).toEqual(["Ocean Eyes"]);
    expect(res.singles).toEqual([]);
    expect(res.singlesTruncated).toBe(false);
  });

  describe("the artist's MusicBrainz IDs (P434)", () => {
    async function withIds(values: string[]): Promise<string[]> {
      await db.insert(musicItems).values([item(ARTIST, "artist", "Owl City")]);
      if (values.length)
        await db
          .insert(musicExternalIds)
          .values(values.map((value) => ({ qid: ARTIST, property: P434, value })));
      return (await get(ARTIST)).artist.musicBrainzIds.sort();
    }

    it("has the one it has", async () => {
      expect(await withIds(["mb-owl-city"])).toEqual(["mb-owl-city"]);
    });
    it("has none for an artist without one", async () => {
      expect(await withIds([])).toEqual([]);
    });
    it("has each of several", async () => {
      expect(await withIds(["mb-1", "mb-2"])).toEqual(["mb-1", "mb-2"]);
    });
  });
});
