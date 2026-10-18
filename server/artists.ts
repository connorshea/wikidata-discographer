// An artist's albums and EPs, from the music mirror, for working through a
// discography one album at a time:
//
//   GET /api/artists/search?q=…   artists by name (exact, then prefix), or by QID or Wikidata URL
//   GET /api/artists/:qid         the artist and its albums and EPs, oldest first
import { Hono } from "hono";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db.ts";
import { propertyNumber, qidNumber, toQid } from "./ids.ts";
import { musicExternalIds, musicItems, musicLinks, submissions } from "../db/schema.ts";
import type { AuthEnv } from "./auth/session.ts";
import { searchLabels } from "./items.ts";
import { editGroupUrl } from "./submissions.ts";
import { describeItems, WikidataEditError } from "./wikidata-client.ts";
import { normalizeQid, QID } from "../src/lib/plan.ts";
import { albumType, type MusicKind } from "../src/lib/music.ts";
import { labelSearchKey } from "../src/lib/titles.ts";
import type {
  ArtistAlbum,
  ArtistResponse,
  ArtistResult,
  ArtistSearchResponse,
  SubmissionStatus,
} from "../src/lib/api-types.ts";

export const artistRoutes = new Hono<AuthEnv>();

const P175 = propertyNumber("P175");
const P436 = propertyNumber("P436");
const P658 = propertyNumber("P658");
const ALBUM_KINDS: MusicKind[] = ["album", "ep"];

/** The most albums an artist page lists: the oldest ones, if it has more. */
export const MAX_ARTIST_ALBUMS = 500;

/** The query's QID, if it's one or a Wikidata URL. */
export function queryQid(q: string): string | null {
  const qid = normalizeQid(q);
  return QID.test(qid) ? qid : null;
}

/** How many albums and EPs each artist performs on, as of the mirror. */
async function albumCounts(artists: number[]): Promise<Map<number, number>> {
  if (!artists.length) return new Map();
  const rows = await db
    .select({ target: musicLinks.target, n: count() })
    .from(musicLinks)
    .innerJoin(musicItems, eq(musicItems.qid, musicLinks.qid))
    .where(
      and(
        inArray(musicLinks.target, artists),
        eq(musicLinks.property, P175),
        inArray(musicItems.kind, ALBUM_KINDS),
      ),
    )
    .groupBy(musicLinks.target);
  return new Map(rows.map((r) => [r.target, r.n]));
}

/**
 * Search results in order: exact matches before prefix ones, as found, and
 * within each, the artists with the most albums first, as a common name is
 * most likely the well-known artist.
 */
export function rankArtists(
  found: { qid: number; exact: boolean }[],
  albums: ReadonlyMap<number, number>,
): number[] {
  return found
    .map((f, i) => ({ ...f, i, n: albums.get(f.qid) ?? 0 }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.n - a.n || a.i - b.i)
    .map((f) => f.qid);
}

/**
 * The artist's label and description: the mirror's, else Wikidata's. Artists
 * without an artist identifier aren't in the mirror, though albums can still
 * name them as performer. Null if it isn't an artist, or doesn't exist.
 */
async function findArtist(qid: string): Promise<ArtistResponse["artist"] | null> {
  const [row] = await db
    .select({ kind: musicItems.kind, label: musicItems.label, description: musicItems.description })
    .from(musicItems)
    .where(eq(musicItems.qid, qidNumber(qid)));
  if (row)
    return row.kind === "artist" ? { qid, label: row.label, description: row.description } : null;
  // The user is waiting on this: retry a transient failure once.
  const found = (await describeItems([qid], "en", { retries: 1 })).get(qid);
  return found?.status === "ok"
    ? { qid, label: found.label, description: found.description }
    : null;
}

artistRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const qid = queryQid(q);
  if (qid) {
    let artist;
    try {
      artist = await findArtist(qid);
    } catch (err) {
      if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
      throw err;
    }
    const albums = artist ? await albumCounts([qidNumber(qid)]) : new Map<number, number>();
    return c.json({
      artists: artist
        ? [{ ...artist, kind: "artist", albums: albums.get(qidNumber(qid)) ?? 0 }]
        : [],
    } satisfies ArtistSearchResponse);
  }
  const rows = await searchLabels(q, ["artist"]);
  const albums = await albumCounts(rows.map((r) => r.qid));
  const byQid = new Map(rows.map((r) => [r.qid, r]));
  const key = labelSearchKey(q);
  const artists: ArtistResult[] = rankArtists(
    rows.map((r) => ({ qid: r.qid, exact: labelSearchKey(r.label) === key })),
    albums,
  ).map((n) => {
    const r = byQid.get(n)!;
    return {
      qid: toQid(n),
      kind: "artist",
      label: r.label,
      description: r.description,
      albums: albums.get(n) ?? 0,
    };
  });
  return c.json({ artists } satisfies ArtistSearchResponse);
});

/** A run on one of the artist's albums, as read from the database. */
export interface ArtistRunRow {
  id: number;
  albumQid: number;
  userId: number;
  status: string;
  editGroup: string;
  createdAt: string;
}

/** An album row joined with what the mirror and the runs know of it. */
export interface AlbumRow {
  qid: number;
  kind: string;
  label: string | null;
  instanceOf: number[];
  released: string | null;
}

/**
 * The artist's albums, oldest first, with the latest run on each. Albums with
 * no release date go last, and ones released the same day by title.
 */
export function artistAlbums(
  rows: AlbumRow[],
  facts: {
    parts: ReadonlyMap<number, number | null>;
    tracks: ReadonlyMap<number, number>;
    releaseGroups: ReadonlyMap<number, string[]>;
    runs: ArtistRunRow[];
  },
  userId: number | null,
): ArtistAlbum[] {
  const latest = new Map<number, ArtistRunRow>();
  for (const r of facts.runs)
    if ((latest.get(r.albumQid)?.id ?? 0) < r.id) latest.set(r.albumQid, r);
  return rows
    .map((r): ArtistAlbum => {
      const run = latest.get(r.qid);
      return {
        qid: toQid(r.qid),
        label: r.label,
        type: albumType(r.kind as MusicKind, r.instanceOf.map(toQid)),
        released: r.released,
        tracks: facts.tracks.get(r.qid) ?? 0,
        parts: facts.parts.get(r.qid) ?? null,
        releaseGroups: facts.releaseGroups.get(r.qid) ?? [],
        run: run
          ? {
              id: run.id,
              status: run.status as SubmissionStatus,
              mine: run.userId === userId,
              createdAt: run.createdAt,
              editGroupUrl: editGroupUrl(run.editGroup),
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        (a.released === null ? 1 : 0) - (b.released === null ? 1 : 0) ||
        (a.released ?? "").localeCompare(b.released ?? "") ||
        (a.label ?? a.qid).localeCompare(b.label ?? b.qid),
    );
}

artistRoutes.get("/:qid", async (c) => {
  const qid = c.req.param("qid").toUpperCase();
  if (!QID.test(qid)) return c.json({ error: "Not a QID" }, 400);
  let artist;
  try {
    artist = await findArtist(qid);
  } catch (err) {
    if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
    throw err;
  }
  if (!artist) return c.json({ error: `${qid} isn't an artist on Wikidata` }, 404);

  const rows = await db
    .select({
      qid: musicItems.qid,
      kind: musicItems.kind,
      label: musicItems.label,
      instanceOf: musicItems.instanceOf,
      released: musicItems.released,
      parts: musicItems.parts,
    })
    .from(musicLinks)
    .innerJoin(musicItems, eq(musicItems.qid, musicLinks.qid))
    .where(
      and(
        eq(musicLinks.target, qidNumber(qid)),
        eq(musicLinks.property, P175),
        inArray(musicItems.kind, ALBUM_KINDS),
      ),
    )
    // In the page's order, so a long discography keeps its oldest albums.
    .orderBy(isNull(musicItems.released), asc(musicItems.released), asc(musicItems.qid))
    .limit(MAX_ARTIST_ALBUMS + 1);
  const truncated = rows.length > MAX_ARTIST_ALBUMS;
  const albums = rows.slice(0, MAX_ARTIST_ALBUMS);
  const qids = albums.map((r) => r.qid);
  const [tracks, ids, runs] = qids.length
    ? await Promise.all([
        db
          .select({ qid: musicLinks.qid, n: count() })
          .from(musicLinks)
          .where(and(inArray(musicLinks.qid, qids), eq(musicLinks.property, P658)))
          .groupBy(musicLinks.qid),
        db
          .select({ qid: musicExternalIds.qid, value: musicExternalIds.value })
          .from(musicExternalIds)
          .where(and(inArray(musicExternalIds.qid, qids), eq(musicExternalIds.property, P436))),
        db
          .select({
            id: submissions.id,
            albumQid: submissions.albumQid,
            userId: submissions.userId,
            status: submissions.status,
            editGroup: submissions.editGroup,
            createdAt: submissions.createdAt,
          })
          .from(submissions)
          .where(inArray(submissions.albumQid, qids)),
      ])
    : [[], [], []];
  const releaseGroups = new Map<number, string[]>();
  for (const r of ids) releaseGroups.set(r.qid, [...(releaseGroups.get(r.qid) ?? []), r.value]);

  c.header("Cache-Control", "no-store");
  return c.json({
    artist,
    albums: artistAlbums(
      albums,
      {
        parts: new Map(albums.map((r) => [r.qid, r.parts])),
        tracks: new Map(tracks.map((r) => [r.qid, r.n])),
        releaseGroups,
        runs: runs.map((r) => ({ ...r, albumQid: r.albumQid! })),
      },
      c.get("user")?.id ?? null,
    ),
    truncated,
  } satisfies ArtistResponse);
});
