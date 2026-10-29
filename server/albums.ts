// The albums the tool has created or added a tracklist to, across every
// user's runs:
//
//   GET /api/albums?before=<run id>&mine=1   a page of albums, newest run first
//
// Public, like the edits themselves: usernames are already shown in each
// item's history and on EditGroups. `mine=1` keeps the albums the logged-in
// user has a run on.
import { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { db } from "./db.ts";
import { musicItems, musicLinks, submissions, users, wikidataEdits } from "../db/schema.ts";
import type { AuthEnv } from "./auth/session.ts";
import { propertyNumber, toQid } from "./ids.ts";
import { editGroupUrl } from "./submissions.ts";
import { albumType, type MusicKind } from "../src/lib/music.ts";
import { EP_CLASS, SINGLE_CLASS } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";
import type {
  AlbumListEntry,
  AlbumListResponse,
  RunArtist,
  SubmissionStatus,
} from "../src/lib/api-types.ts";

const P175 = propertyNumber("P175");

/** Albums per page. */
export const ALBUM_PAGE_SIZE = 50;

/** A run on one of the page's albums, as read from the database. */
export interface RunRow {
  id: number;
  albumQid: number;
  username: string;
  status: string;
  title: string;
  editGroup: string;
  createdAt: string;
  finishedAt: string | null;
}

/** What a run's edits created. */
export interface RunEdits {
  created: number;
  createdAlbum: boolean;
}

/** The kinds of item the album list gives a type. */
const RELEASE_KINDS: readonly MusicKind[] = ["album", "ep", "single"];

/** A mirrored item's type, or null for something that isn't a release. */
export function mirrorType(kind: string, instanceOf: readonly number[]): string | null {
  return RELEASE_KINDS.includes(kind as MusicKind)
    ? albumType(kind as MusicKind, instanceOf.map(toQid))
    : null;
}

/**
 * What a run's form said the release was, for one the mirror doesn't have yet:
 * a new release's type and form, or "Single" for an existing single. Null when
 * the form doesn't say.
 */
export function inputType(input: unknown): string | null {
  const { album } = coerceState(input);
  if (album.mode === "existing")
    return album.singleQid && album.singleQid === album.qid.trim() ? "Single" : null;
  if (album.type === SINGLE_CLASS) return "Single";
  return albumType(album.type === EP_CLASS ? "ep" : "album", album.form ? [album.form] : []);
}

/**
 * One entry per album, in the order of `albumQids`, with its runs newest
 * first. The label is the mirror's, else the title of the album's latest run.
 * The artists are the album's performers (P175) in the mirror that have a label, and
 * the type is the mirror's or what the latest run's form said.
 */
export function groupAlbums(
  albumQids: number[],
  runs: RunRow[],
  edits: Map<number, RunEdits>,
  labels: Map<number, string>,
  artists: Map<number, RunArtist[]>,
  types: Map<number, string>,
): AlbumListEntry[] {
  const byAlbum = new Map<number, RunRow[]>(albumQids.map((q) => [q, []]));
  for (const r of [...runs].sort((a, b) => b.id - a.id)) byAlbum.get(r.albumQid)?.push(r);
  return albumQids.flatMap((qid) => {
    const albumRuns = byAlbum.get(qid)!;
    if (!albumRuns.length) return [];
    const entryRuns = albumRuns.map((r) => {
      const e = edits.get(r.id) ?? { created: 0, createdAlbum: false };
      return {
        id: r.id,
        status: r.status as SubmissionStatus,
        username: r.username,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        editGroupUrl: editGroupUrl(r.editGroup),
        created: e.created,
        createdAlbum: e.createdAlbum,
      };
    });
    return [
      {
        qid: toQid(qid),
        label: labels.get(qid) || albumRuns[0].title,
        artists: artists.get(qid) ?? [],
        type: types.get(qid) ?? null,
        created: entryRuns.some((r) => r.createdAlbum),
        runs: entryRuns,
      },
    ];
  });
}

/** MariaDB returns JSON as a string. */
const parseJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

/** A run counts an item as created once Wikidata saved it, even if the answer came late. */
const saved = sql`(${wikidataEdits.ok} OR ${wikidataEdits.qid} IS NOT NULL)`;

export const albumRoutes = new Hono<AuthEnv>();

albumRoutes.get("/", async (c) => {
  const user = c.get("user");
  const before = Number(c.req.query("before"));
  const mine = c.req.query("mine") === "1";
  if (mine && !user) return c.json({ error: "Log in to see your albums" }, 401);

  // A page of albums, by their latest run. Paging by that run's id, not an
  // offset, so a new run doesn't shift the next page.
  const paged = Number.isInteger(before) && before > 0;
  let page: { albumQid: number; latest: number }[];
  if (mine) {
    // Starts from the user's runs, so it reads only as many albums as they have.
    const latest = sql<number>`max(${submissions.id})`;
    page = (
      await db
        .select({ albumQid: submissions.albumQid, latest })
        .from(submissions)
        .where(
          inArray(
            submissions.albumQid,
            db
              .select({ qid: submissions.albumQid })
              .from(submissions)
              .where(and(eq(submissions.userId, user!.id), isNotNull(submissions.albumQid))),
          ),
        )
        .groupBy(submissions.albumQid)
        .having(paged ? lt(latest, before) : undefined)
        .orderBy(desc(latest))
        .limit(ALBUM_PAGE_SIZE + 1)
    ).map((p) => ({ albumQid: p.albumQid!, latest: Number(p.latest) }));
  } else {
    // Walks the runs newest first and keeps each album's latest, so it stops
    // after a page instead of grouping every album.
    const newer = alias(submissions, "newer");
    page = (
      await db
        .select({ albumQid: submissions.albumQid, latest: submissions.id })
        .from(submissions)
        .where(
          and(
            isNotNull(submissions.albumQid),
            paged ? lt(submissions.id, before) : undefined,
            notExists(
              db
                .select({ one: sql`1` })
                .from(newer)
                .where(and(eq(newer.albumQid, submissions.albumQid), gt(newer.id, submissions.id))),
            ),
          ),
        )
        .orderBy(desc(submissions.id))
        .limit(ALBUM_PAGE_SIZE + 1)
    ).map((p) => ({ albumQid: p.albumQid!, latest: p.latest }));
  }
  const more = page.length > ALBUM_PAGE_SIZE;
  page = page.slice(0, ALBUM_PAGE_SIZE);
  const albumQids = page.map((p) => p.albumQid);

  // Everything else only needs the page's albums, so it's read in one go.
  const [runs, edits, labels, performers, latestInputs]: [
    RunRow[],
    { submissionId: number; created: string; createdAlbum: string }[],
    { qid: number; label: string | null; kind: string; instanceOf: number[] }[],
    { qid: number; target: number; label: string | null }[],
    { albumQid: number | null; album: unknown }[],
  ] = albumQids.length
    ? await Promise.all([
        db
          .select({
            id: submissions.id,
            albumQid: submissions.albumQid,
            username: users.username,
            status: submissions.status,
            title: submissions.title,
            editGroup: submissions.editGroup,
            createdAt: submissions.createdAt,
            finishedAt: submissions.finishedAt,
          })
          .from(submissions)
          .innerJoin(users, eq(users.id, submissions.userId))
          .where(inArray(submissions.albumQid, albumQids))
          .then((rows) => rows.map((r) => ({ ...r, albumQid: r.albumQid! }))),
        // Only creates count, and idx_wikidata_edits_created covers them.
        db
          .select({
            submissionId: wikidataEdits.submissionId,
            created: sql<string>`count(*)`,
            createdAlbum: sql<string>`max(${wikidataEdits.key} = 'album')`,
          })
          .from(wikidataEdits)
          .innerJoin(submissions, eq(submissions.id, wikidataEdits.submissionId))
          .where(
            and(inArray(submissions.albumQid, albumQids), eq(wikidataEdits.op, "create"), saved),
          )
          .groupBy(wikidataEdits.submissionId),
        db
          .select({
            qid: musicItems.qid,
            label: musicItems.label,
            kind: musicItems.kind,
            instanceOf: musicItems.instanceOf,
          })
          .from(musicItems)
          .where(inArray(musicItems.qid, albumQids)),
        db
          .select({ qid: musicLinks.qid, target: musicLinks.target, label: musicItems.label })
          .from(musicLinks)
          .innerJoin(musicItems, eq(musicItems.qid, musicLinks.target))
          .where(and(inArray(musicLinks.qid, albumQids), eq(musicLinks.property, P175))),
        // Just the form's album, not the whole tracklist.
        db
          .select({
            albumQid: submissions.albumQid,
            album: sql<unknown>`json_extract(${submissions.input}, '$.album')`.mapWith(parseJson),
          })
          .from(submissions)
          .where(
            inArray(
              submissions.id,
              page.map((p) => p.latest),
            ),
          ),
      ])
    : [[], [], [], [], []];
  const artists = new Map<number, RunArtist[]>();
  for (const p of performers)
    if (p.label)
      artists.set(p.qid, [...(artists.get(p.qid) ?? []), { qid: toQid(p.target), label: p.label }]);

  // A release the run just created isn't in the mirror until the next dump, so
  // go by what its latest run's form said it was.
  const types = new Map<number, string>();
  for (const l of labels) {
    const type = mirrorType(l.kind, l.instanceOf);
    if (type) types.set(l.qid, type);
  }
  for (const r of latestInputs) {
    if (types.has(r.albumQid!)) continue;
    const type = inputType({ album: r.album });
    if (type) types.set(r.albumQid!, type);
  }

  c.header("Cache-Control", "no-store");
  return c.json({
    albums: groupAlbums(
      albumQids,
      runs,
      new Map(
        edits.map((e) => [
          e.submissionId,
          { created: Number(e.created), createdAlbum: Number(e.createdAlbum) === 1 },
        ]),
      ),
      new Map(labels.flatMap((l) => (l.label ? [[l.qid, l.label]] : []))),
      artists,
      types,
    ),
    next: more ? page[ALBUM_PAGE_SIZE - 1].latest : null,
  } satisfies AlbumListResponse);
});
