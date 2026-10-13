// Read routes over the music mirror, plus adding an item to it:
//
//   GET  /api/items/search?q=…&kind=artist   label search (exact, then prefix)
//   POST /api/items/duplicates               possible duplicates of a new album
//   POST /api/items/matches                  existing items for a tracklist (server/matches.ts)
//   POST /api/items/describe                 labels, descriptions and classes, live from Wikidata
//   GET  /api/items/:qid/tracklist           an album's tracklist and release groups, live from Wikidata
//   POST /api/items/:qid                     fetch an item from Wikidata into the mirror
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "./db.ts";
import { propertyNumber, toProperty, toQid } from "./ids.ts";
import { musicExternalIds, musicItems, musicLinks } from "../db/schema.ts";
import { type AuthEnv, requireUser } from "./auth/session.ts";
import { rankDuplicates, titleReasons } from "./duplicates.ts";
import { findMatches } from "./matches.ts";
import { entityToRow, upsertRows } from "./mirror.ts";
import { foldTitle, labelSearchKey, SIMILAR_TITLE, titleKey } from "../src/lib/titles.ts";
import {
  describeItems,
  getEntities,
  getStatementValues,
  WikidataEditError,
} from "./wikidata-client.ts";
import { WD_LANG_CODES } from "../src/lib/languages.ts";
import { MBID_RE } from "../src/lib/musicbrainz.ts";
import { ID_PROPERTIES, MUSIC_KINDS, type MusicKind } from "../src/lib/music.ts";
import type {
  AddItemResponse,
  DescribeRequest,
  DescribeResponse,
  DuplicateMatch,
  DuplicatesRequest,
  DuplicatesResponse,
  MatchesRequest,
  MatchesResponse,
  MirrorItem,
  SearchResponse,
  TracklistResponse,
} from "../src/lib/api-types.ts";

export const items = new Hono<AuthEnv>();

const columns = {
  qid: musicItems.qid,
  kind: musicItems.kind,
  label: musicItems.label,
  description: musicItems.description,
};
type Selected = { qid: number; kind: string; label: string | null; description: string | null };
const toItem = (r: Selected): MirrorItem => ({
  ...r,
  qid: toQid(r.qid),
  kind: r.kind as MusicKind,
});

const P175 = propertyNumber("P175");

const isKind = (k: unknown): k is MusicKind => MUSIC_KINDS.includes(k as MusicKind);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

items.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const key = labelSearchKey(q);
  const kind = c.req.query("kind");
  if (!key) return c.json({ items: [] } satisfies SearchResponse);
  // A short query keeps its punctuation, but the longer titles it starts are
  // keyed folded, so match their start folded too ("#1" finds "#1 Crush").
  const start = foldTitle(q) || key;
  const kindFilter = isKind(kind) ? eq(musicItems.kind, kind) : undefined;
  const exact = await db
    .select(columns)
    .from(musicItems)
    .where(and(eq(musicItems.labelSearch, key), kindFilter))
    .limit(20);
  const prefix =
    exact.length < 10
      ? await db
          .select(columns)
          .from(musicItems)
          .where(and(like(musicItems.labelSearch, `${escapeLike(start)}%`), kindFilter))
          .limit(10)
      : [];
  const seen = new Set<number>();
  const result = [...exact, ...prefix].filter((r) => !seen.has(r.qid) && seen.add(r.qid));
  return c.json({ items: result.map(toItem) } satisfies SearchResponse);
});

items.post("/duplicates", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<DuplicatesRequest>;
  const kinds = Array.isArray(body.kinds) ? body.kinds.filter(isKind) : [];
  const ids = Object.entries(body.ids ?? {}).filter(
    ([p, v]) => p in ID_PROPERTIES && typeof v === "string" && v.trim() !== "",
  );
  const artists = (Array.isArray(body.performers) ? body.performers : [])
    .filter((p): p is string => typeof p === "string" && /^Q\d+$/.test(p))
    .slice(0, 20);
  const reasons = new Map<number, string[]>();
  const add = (qid: number, reason: string) =>
    reasons.set(qid, [...(reasons.get(qid) ?? []), reason]);

  if (ids.length) {
    const hits = await db
      .select({ qid: musicExternalIds.qid, property: musicExternalIds.property })
      .from(musicExternalIds)
      .where(
        or(
          ...ids.map(([p, v]) =>
            and(
              eq(musicExternalIds.property, propertyNumber(p)),
              eq(musicExternalIds.value, v.trim()),
            ),
          ),
        ),
      )
      .limit(50);
    for (const h of hits) add(h.qid, `same ${ID_PROPERTIES[toProperty(h.property)]}`);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const key = labelSearchKey(title);
  if (key && kinds.length) {
    const hits = await db
      .select({ qid: musicItems.qid, label: musicItems.label })
      .from(musicItems)
      .where(and(eq(musicItems.labelSearch, key), inArray(musicItems.kind, kinds)))
      .limit(30);
    const credited = new Map<number, string[]>();
    if (artists.length && hits.length) {
      const links = await db
        .select({ qid: musicLinks.qid, target: musicLinks.target })
        .from(musicLinks)
        .where(
          and(
            inArray(
              musicLinks.qid,
              hits.map((h) => h.qid),
            ),
            eq(musicLinks.property, P175),
          ),
        );
      for (const l of links) credited.set(l.qid, [...(credited.get(l.qid) ?? []), toQid(l.target)]);
    }
    for (const h of hits)
      for (const r of titleReasons(
        credited.get(h.qid) ?? [],
        artists,
        h.label !== null && titleKey(h.label) === titleKey(title) ? "same title" : SIMILAR_TITLE,
      ) ?? [])
        add(h.qid, r);
  }
  if (reasons.size === 0) return c.json({ matches: [] } satisfies DuplicatesResponse);
  const rows = await db
    .select(columns)
    .from(musicItems)
    .where(inArray(musicItems.qid, [...reasons.keys()]));
  const matches: DuplicateMatch[] = rows.map((r) => ({
    ...toItem(r),
    reasons: reasons.get(r.qid)!,
  }));
  return c.json({ matches: rankDuplicates(matches) } satisfies DuplicatesResponse);
});

items.post("/matches", bodyLimit({ maxSize: 256 << 10 }), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<MatchesRequest>;
  return c.json((await findMatches(body)) satisfies MatchesResponse);
});

const MAX_DESCRIBE = 200;

items.post("/describe", bodyLimit({ maxSize: 16 << 10 }), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<DescribeRequest>;
  const qids = (Array.isArray(body.qids) ? body.qids : []).filter(
    (q): q is string => typeof q === "string" && /^Q\d+$/.test(q),
  );
  const lang = typeof body.lang === "string" && WD_LANG_CODES.has(body.lang) ? body.lang : "en";
  if (qids.length > MAX_DESCRIBE) return c.json({ error: `At most ${MAX_DESCRIBE} QIDs` }, 400);
  try {
    // The user is waiting on this: retry a transient failure once.
    const found = await describeItems(qids, lang, { retries: 1 });
    return c.json({ items: Object.fromEntries(found) } satisfies DescribeResponse);
  } catch (err) {
    if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

items.get("/:qid/tracklist", async (c) => {
  const qid = c.req.param("qid").toUpperCase();
  if (!/^Q\d+$/.test(qid)) return c.json({ error: "Not a QID" }, 400);
  try {
    // Asked live, not from the mirror: a tracklist added since the last dump counts.
    const { P658, P436 } = await getStatementValues(qid, ["P658", "P436"], { retries: 0 });
    return c.json({
      tracks: P658,
      releaseGroups: [...new Set(P436.filter((v) => MBID_RE.test(v)).map((v) => v.toLowerCase()))],
    } satisfies TracklistResponse);
  } catch (err) {
    if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

items.post("/:qid", requireUser, async (c) => {
  const qid = c.req.param("qid").toUpperCase();
  if (!/^Q\d+$/.test(qid)) return c.json({ error: "Not a QID" }, 400);
  let entity;
  try {
    // The user is waiting on this: no retries (a 429 may ask for a minute's
    // wait); they can click again.
    entity = (await getEntities([qid], { retries: 0 })).get(qid);
  } catch (err) {
    if (err instanceof WikidataEditError) return c.json({ error: err.message }, 502);
    throw err;
  }
  if (!entity) return c.json({ error: `${qid} doesn't exist on Wikidata` }, 404);
  if (entity.id !== qid) return c.json({ error: `${qid} is a redirect to ${entity.id}` }, 422);
  const row = entityToRow(entity);
  if (!row)
    return c.json(
      {
        error: `${qid} isn't an artist, album, EP, single, composition or track (by its instance of and identifiers)`,
      },
      422,
    );
  await upsertRows([row], { source: "app" });
  return c.json({
    item: { qid: row.qid, kind: row.kind, label: row.label, description: row.description },
  } satisfies AddItemResponse);
});
