// The albums the tool has created or added a tracklist to, across every
// user's runs:
//
//   GET /api/albums?before=<run id>&mine=1   a page of albums, newest run first
//
// Public, like the edits themselves: usernames are already shown in each
// item's history and on EditGroups. `mine=1` keeps the albums the logged-in
// user has a run on.
import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { musicItems, submissions, users, wikidataEdits } from "../db/schema.ts";
import type { AuthEnv } from "./auth/session.ts";
import { toQid } from "./ids.ts";
import { editGroupUrl } from "./submissions.ts";
import type { AlbumListEntry, AlbumListResponse, SubmissionStatus } from "../src/lib/api-types.ts";

/** Albums per page. */
export const ALBUM_PAGE_SIZE = 50;

/** A run on one of the page's albums, as read from the database. */
export interface RunRow {
  id: number;
  albumQid: number;
  userId: number;
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

/**
 * One entry per album, in the order of `albumQids`, with its runs newest
 * first. The label is the mirror's, else the title of the album's latest run.
 */
export function groupAlbums(
  albumQids: number[],
  runs: RunRow[],
  edits: Map<number, RunEdits>,
  labels: Map<number, string>,
  userId: number | null,
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
        mine: r.userId === userId,
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
        created: entryRuns.some((r) => r.createdAlbum),
        runs: entryRuns,
      },
    ];
  });
}

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
  const latest = sql<number>`max(${submissions.id})`;
  const page = await db
    .select({ albumQid: submissions.albumQid, latest })
    .from(submissions)
    .where(
      and(
        isNotNull(submissions.albumQid),
        mine
          ? inArray(
              submissions.albumQid,
              db
                .select({ qid: submissions.albumQid })
                .from(submissions)
                .where(eq(submissions.userId, user!.id)),
            )
          : undefined,
      ),
    )
    .groupBy(submissions.albumQid)
    .having(Number.isInteger(before) && before > 0 ? lt(latest, before) : undefined)
    .orderBy(desc(latest))
    .limit(ALBUM_PAGE_SIZE + 1);
  const more = page.length > ALBUM_PAGE_SIZE;
  const albumQids = page.slice(0, ALBUM_PAGE_SIZE).map((p) => p.albumQid!);

  const runs: RunRow[] = albumQids.length
    ? (
        await db
          .select({
            id: submissions.id,
            albumQid: submissions.albumQid,
            userId: submissions.userId,
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
      ).map((r) => ({ ...r, albumQid: r.albumQid! }))
    : [];
  const runIds = runs.map((r) => r.id);
  const [edits, labels] = await Promise.all([
    runIds.length
      ? db
          .select({
            submissionId: wikidataEdits.submissionId,
            created: sql<string>`sum(${wikidataEdits.op} = 'create' AND ${saved})`,
            createdAlbum: sql<string>`max(${wikidataEdits.op} = 'create' AND ${wikidataEdits.key} = 'album' AND ${saved})`,
          })
          .from(wikidataEdits)
          .where(inArray(wikidataEdits.submissionId, runIds))
          .groupBy(wikidataEdits.submissionId)
      : [],
    albumQids.length
      ? db
          .select({ qid: musicItems.qid, label: musicItems.label })
          .from(musicItems)
          .where(inArray(musicItems.qid, albumQids))
      : [],
  ]);

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
      user?.id ?? null,
    ),
    next: more ? Number(page[ALBUM_PAGE_SIZE - 1].latest) : null,
  } satisfies AlbumListResponse);
});
