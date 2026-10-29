// An artist's albums and EPs, from the music mirror, for working through a
// discography one album at a time:
//
//   GET /api/artists/search?q=…   artists by name (exact, then prefix), or by QID or Wikidata URL
//   GET /api/artists/:qid         the artist and its albums, EPs and singles, oldest first
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
import { albumType, BLOCKED_ARTISTS, type MusicKind } from "../src/lib/music.ts";
import { labelSearchKey } from "../src/lib/titles.ts";
import type {
  ArtistAlbum,
  ArtistResponse,
  ArtistResult,
  ArtistSearchResponse,
  ArtistSingle,
  SubmissionStatus,
} from "../src/lib/api-types.ts";

export const artistRoutes = new Hono<AuthEnv>();

const P175 = propertyNumber("P175");
const P434 = propertyNumber("P434");
const P436 = propertyNumber("P436");
const P658 = propertyNumber("P658");
const P13602 = propertyNumber("P13602");
const ALBUM_KINDS: MusicKind[] = ["album", "ep"];

/** The most albums an artist page lists: the oldest ones, if it has more. */
export const MAX_ARTIST_ALBUMS = 500;
/** The most singles an artist page lists: the oldest ones, if it has more. */
export const MAX_ARTIST_SINGLES = 500;

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
 * name them as performer, so one of those counts if something in the mirror
 * does. Null if it isn't an artist, or doesn't exist.
 */
async function findArtist(
  qid: string,
): Promise<Omit<ArtistResponse["artist"], "musicBrainzIds"> | null> {
  const [row] = await db
    .select({ kind: musicItems.kind, label: musicItems.label, description: musicItems.description })
    .from(musicItems)
    .where(eq(musicItems.qid, qidNumber(qid)));
  if (row)
    return row.kind === "artist" ? { qid, label: row.label, description: row.description } : null;
  // One that nothing names as performer, like "human" (Q5), isn't an artist.
  const [performs] = await db
    .select({ qid: musicLinks.qid })
    .from(musicLinks)
    .where(and(eq(musicLinks.target, qidNumber(qid)), eq(musicLinks.property, P175)))
    .limit(1);
  if (!performs) return null;
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
    if (BLOCKED_ARTISTS.has(qid)) return c.json({ artists: [] } satisfies ArtistSearchResponse);
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
  const rows = (await searchLabels(q, ["artist"])).filter(
    (r) => !BLOCKED_ARTISTS.has(toQid(r.qid)),
  );
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
): ArtistAlbum[] {
  const runOf = latestRuns(facts.runs);
  return rows
    .map((r): ArtistAlbum => ({
      qid: toQid(r.qid),
      label: r.label,
      type: albumType(r.kind as MusicKind, r.instanceOf.map(toQid)),
      released: r.released,
      tracks: facts.tracks.get(r.qid) ?? 0,
      parts: facts.parts.get(r.qid) ?? null,
      releaseGroups: facts.releaseGroups.get(r.qid) ?? [],
      run: runOf(r.qid),
    }))
    .sort(byRelease);
}

/** The latest run on each album or single, as the artist page shows it. */
function latestRuns(runs: ArtistRunRow[]) {
  const latest = new Map<number, ArtistRunRow>();
  for (const r of runs) if ((latest.get(r.albumQid)?.id ?? 0) < r.id) latest.set(r.albumQid, r);
  return (qid: number): ArtistAlbum["run"] => {
    const run = latest.get(qid);
    return run
      ? {
          id: run.id,
          status: run.status as SubmissionStatus,
          createdAt: run.createdAt,
          editGroupUrl: editGroupUrl(run.editGroup),
        }
      : null;
  };
}

/** Oldest first, undated last, and ones released the same day by title. */
function byRelease(
  a: { qid: string; label: string | null; released: string | null },
  b: { qid: string; label: string | null; released: string | null },
): number {
  return (
    (a.released === null ? 1 : 0) - (b.released === null ? 1 : 0) ||
    (a.released ?? "").localeCompare(b.released ?? "") ||
    (a.label ?? a.qid).localeCompare(b.label ?? b.qid)
  );
}

/** A single row, as read from the database. */
export interface SingleRow {
  qid: number;
  label: string | null;
  released: string | null;
  parts: number | null;
}

/**
 * The artist's singles, sorted like its albums, each with the albums it's
 * taken from (P13602) by label and the latest run on it. An album missing
 * from `labels` (not in the mirror) has no label.
 */
export function artistSingles(
  rows: SingleRow[],
  facts: {
    tracks: ReadonlyMap<number, number>;
    takenFrom: ReadonlyMap<number, number[]>;
    labels: ReadonlyMap<number, string | null>;
    releaseGroups: ReadonlyMap<number, string[]>;
    runs: ArtistRunRow[];
  },
): ArtistSingle[] {
  const runOf = latestRuns(facts.runs);
  return rows
    .map((r): ArtistSingle => ({
      qid: toQid(r.qid),
      label: r.label,
      released: r.released,
      tracks: facts.tracks.get(r.qid) ?? 0,
      parts: r.parts,
      releaseGroups: facts.releaseGroups.get(r.qid) ?? [],
      run: runOf(r.qid),
      takenFrom: (facts.takenFrom.get(r.qid) ?? [])
        .map((n) => ({ qid: toQid(n), label: facts.labels.get(n) ?? null }))
        .sort((a, b) => (a.label ?? a.qid).localeCompare(b.label ?? b.qid)),
    }))
    .sort(byRelease);
}

/**
 * The items of these kinds with the artist as performer, at most `max` (plus
 * one, to tell when there are more), oldest first, as the page lists them.
 */
function performedBy(artist: number, kinds: MusicKind[], max: number) {
  return (
    db
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
          eq(musicLinks.target, artist),
          eq(musicLinks.property, P175),
          inArray(musicItems.kind, kinds),
        ),
      )
      // In the page's order, so a long discography keeps its oldest items.
      .orderBy(isNull(musicItems.released), asc(musicItems.released), asc(musicItems.qid))
      .limit(max + 1)
  );
}

artistRoutes.get("/:qid", async (c) => {
  const qid = c.req.param("qid").toUpperCase();
  if (!QID.test(qid)) return c.json({ error: "Not a QID" }, 400);
  const blocked = BLOCKED_ARTISTS.get(qid);
  if (blocked) return c.json({ error: `${blocked} can't be opened on the artist page` }, 404);
  let artist;
  try {
    artist = await findArtist(qid);
  } catch (err) {
    if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
    throw err;
  }
  if (!artist) return c.json({ error: `${qid} isn't an artist on Wikidata` }, 404);

  const [rows, singleRows, mbids] = await Promise.all([
    performedBy(qidNumber(qid), ALBUM_KINDS, MAX_ARTIST_ALBUMS),
    performedBy(qidNumber(qid), ["single"], MAX_ARTIST_SINGLES),
    // None for an artist that isn't in the mirror, which findArtist read from Wikidata.
    db
      .select({ value: musicExternalIds.value })
      .from(musicExternalIds)
      .where(and(eq(musicExternalIds.qid, qidNumber(qid)), eq(musicExternalIds.property, P434))),
  ]);
  const truncated = rows.length > MAX_ARTIST_ALBUMS;
  const albums = rows.slice(0, MAX_ARTIST_ALBUMS);
  const singles = singleRows.slice(0, MAX_ARTIST_SINGLES);
  const qids = albums.map((r) => r.qid);
  const singleQids = singles.map((r) => r.qid);
  const [tracks, fromLinks, ids, runs] = await Promise.all([
    qids.length || singleQids.length
      ? db
          .select({ qid: musicLinks.qid, n: count() })
          .from(musicLinks)
          .where(
            and(inArray(musicLinks.qid, [...qids, ...singleQids]), eq(musicLinks.property, P658)),
          )
          .groupBy(musicLinks.qid)
      : [],
    // Not just the artist's albums: a single can be taken from a compilation
    // or another artist's album.
    singleQids.length
      ? db
          .select({ qid: musicLinks.qid, target: musicLinks.target, label: musicItems.label })
          .from(musicLinks)
          .leftJoin(musicItems, eq(musicItems.qid, musicLinks.target))
          .where(and(inArray(musicLinks.qid, singleQids), eq(musicLinks.property, P13602)))
      : [],
    qids.length || singleQids.length
      ? db
          .select({ qid: musicExternalIds.qid, value: musicExternalIds.value })
          .from(musicExternalIds)
          .where(
            and(
              inArray(musicExternalIds.qid, [...qids, ...singleQids]),
              eq(musicExternalIds.property, P436),
            ),
          )
      : [],
    qids.length || singleQids.length
      ? db
          .select({
            id: submissions.id,
            albumQid: submissions.albumQid,
            status: submissions.status,
            editGroup: submissions.editGroup,
            createdAt: submissions.createdAt,
          })
          .from(submissions)
          .where(inArray(submissions.albumQid, [...qids, ...singleQids]))
      : [],
  ]);
  const releaseGroups = new Map<number, string[]>();
  for (const r of ids) releaseGroups.set(r.qid, [...(releaseGroups.get(r.qid) ?? []), r.value]);
  const takenFrom = new Map<number, number[]>();
  for (const r of fromLinks) takenFrom.set(r.qid, [...(takenFrom.get(r.qid) ?? []), r.target]);
  const trackCounts = new Map(tracks.map((r) => [r.qid, r.n]));
  const artistRuns = runs.map((r) => ({ ...r, albumQid: r.albumQid! }));

  c.header("Cache-Control", "no-store");
  return c.json({
    artist: { ...artist, musicBrainzIds: mbids.map((r) => r.value) },
    albums: artistAlbums(albums, {
      parts: new Map(albums.map((r) => [r.qid, r.parts])),
      tracks: trackCounts,
      releaseGroups,
      runs: artistRuns,
    }),
    truncated,
    singles: artistSingles(singles, {
      tracks: trackCounts,
      takenFrom,
      labels: new Map(fromLinks.map((r) => [r.target, r.label])),
      releaseGroups,
      runs: artistRuns,
    }),
    singlesTruncated: singleRows.length > MAX_ARTIST_SINGLES,
  } satisfies ArtistResponse);
});
