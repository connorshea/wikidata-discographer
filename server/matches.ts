// Existing compositions, tracks and singles for a tracklist, from the mirror.
//
// A row's direct matches are items with the same title (`labelSearchKey`)
// that also share one of the row's performers (as P175, or P86/P676), or that
// are on the existing album being added to. Titles alone are too common
// ("Intro", "Home") to suggest anything. Each direct match then brings along
// what the music model links to it:
//
//   track —P2550→ composition       the track's composition
//   track —P1433/P361→ single       singles it's on
//   single —P658→ track             the single's track, if it has the title
//
// so reusing a track also reuses the composition it already records, rather
// than creating a second one and giving the track two P2550s.
import { and, eq, exists, inArray, or, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { propertyNumber, qidNumber, toProperty, toQid } from "./ids.ts";
import { musicItems, musicLinks } from "../db/schema.ts";
import { labelSearchKey } from "./mirror.ts";
import type { MusicKind } from "../src/lib/music.ts";
import type {
  Match,
  MatchesRequest,
  MatchesResponse,
  RowMatches,
  TrackMatch,
} from "../src/lib/api-types.ts";

export interface ItemFacts {
  qid: string;
  kind: MusicKind;
  label: string | null;
  description: string | null;
  labelSearch: string | null;
  links: { property: string; target: string }[];
}

type Slot = keyof RowMatches;
const SLOTS: Partial<Record<MusicKind, Slot>> = { work: "comp", track: "track", single: "single" };
const MATCH_KINDS: MusicKind[] = ["work", "track", "single"];
const CREATOR_PROPERTIES = ["P175", "P86", "P676"];
const RELATED_PROPERTIES = ["P2550", "P1433", "P361", "P658"];
const MAX_PER_SLOT = 5;

const targets = (it: ItemFacts, ...properties: string[]) =>
  it.links.filter((l) => properties.includes(l.property)).map((l) => l.target);

/** How strongly a match's reasons tie it to the row, for ordering. */
function score(m: Match): number {
  let n = m.reasons.length;
  if (m.reasons.includes("on this album")) n += 4;
  if (m.reasons.includes("same performer")) n += 2;
  return n;
}

/**
 * Turn the mirror's facts into each row's matches. `items` holds the direct
 * candidates and the items they link to; `albumTracks` the existing album's
 * tracks (its P658, and tracks published in or part of it).
 */
export function assembleMatches(
  rows: MatchesRequest["rows"],
  { items, albumTracks }: { items: Map<string, ItemFacts>; albumTracks: Set<string> },
): MatchesResponse {
  const byTitle = new Map<string, ItemFacts[]>();
  // Singles by the tracks on their tracklist, for a track's `singles`.
  const singlesListing = new Map<string, string[]>();
  for (const it of items.values()) {
    if (it.labelSearch) byTitle.set(it.labelSearch, [...(byTitle.get(it.labelSearch) ?? []), it]);
    if (it.kind === "single")
      for (const t of targets(it, "P658"))
        singlesListing.set(t, [...(singlesListing.get(t) ?? []), it.qid]);
  }
  const singlesOf = (track: ItemFacts) => [
    ...new Set([
      ...targets(track, "P1433", "P361").filter((q) => items.get(q)?.kind === "single"),
      ...(singlesListing.get(track.qid) ?? []),
    ]),
  ];

  const out: MatchesResponse["rows"] = {};
  for (const row of rows) {
    const key = labelSearchKey(row.title.trim());
    if (!key) continue;
    const performers = new Set(row.performers);
    const found: Record<Slot, Map<string, Match>> = {
      comp: new Map(),
      track: new Map(),
      single: new Map(),
    };
    const add = (qid: string, reasons: string[]) => {
      const it = items.get(qid);
      const slot = it && SLOTS[it.kind];
      if (!it || !slot) return;
      const m = found[slot].get(qid);
      if (m) {
        for (const r of reasons) if (!m.reasons.includes(r)) m.reasons.push(r);
        return;
      }
      const base: Match = {
        qid,
        kind: it.kind,
        label: it.label,
        description: it.description,
        reasons: [...reasons],
      };
      if (slot !== "track") return void found[slot].set(qid, base);
      const track: TrackMatch = {
        ...base,
        composition: targets(it, "P2550").find((q) => items.get(q)?.kind === "work") ?? null,
        singles: singlesOf(it),
      };
      found.track.set(qid, track);
    };

    for (const it of byTitle.get(key) ?? []) {
      if (!SLOTS[it.kind]) continue;
      const reasons = ["same title"];
      if (albumTracks.has(it.qid)) reasons.push("on this album");
      if (it.links.some((l) => l.property === "P175" && performers.has(l.target)))
        reasons.push("same performer");
      else if (
        it.links.some((l) => CREATOR_PROPERTIES.includes(l.property) && performers.has(l.target))
      )
        reasons.push("same composer or lyricist");
      if (reasons.length > 1) add(it.qid, reasons);
    }
    // A single's track, when it has the row's title.
    for (const single of [...found.single.keys()])
      for (const t of targets(items.get(single)!, "P658"))
        if (items.get(t)?.labelSearch === key) add(t, [`on single ${single}`]);
    // Each track's composition and singles.
    for (const m of [...found.track.values()] as TrackMatch[]) {
      if (m.composition) add(m.composition, [`recorded as ${m.qid}`]);
      for (const s of m.singles) add(s, [`has ${m.qid} on it`]);
    }

    const ranked = (slot: Slot) =>
      [...found[slot].values()]
        .sort((a, b) => score(b) - score(a) || qidNumber(a.qid) - qidNumber(b.qid))
        .slice(0, MAX_PER_SLOT);
    const result = {
      comp: ranked("comp"),
      track: ranked("track") as TrackMatch[],
      single: ranked("single"),
    };
    if (result.comp.length || result.track.length || result.single.length) out[row.key] = result;
  }
  return { rows: out };
}

// ---------------------------------------------------------------------------
// Reading the facts from the mirror
// ---------------------------------------------------------------------------

const MAX_ROWS = 100;
const MAX_PERFORMERS = 200;
const MAX_CANDIDATES = 2000;
const QID = /^Q\d+$/;
const P658 = propertyNumber("P658");
const PART_OF = ["P1433", "P361"].map(propertyNumber);
const CREATORS = CREATOR_PROPERTIES.map(propertyNumber);

const itemColumns = {
  qid: musicItems.qid,
  kind: musicItems.kind,
  label: musicItems.label,
  description: musicItems.description,
  labelSearch: musicItems.labelSearch,
};

type ItemRow = {
  qid: number;
  kind: string;
  label: string | null;
  description: string | null;
  labelSearch: string | null;
};

/** Add `rows`' links and store them in `items`. */
async function withLinks(rows: ItemRow[], items: Map<string, ItemFacts>): Promise<void> {
  if (rows.length === 0) return;
  const links = await db
    .select({ qid: musicLinks.qid, property: musicLinks.property, target: musicLinks.target })
    .from(musicLinks)
    .where(
      inArray(
        musicLinks.qid,
        rows.map((r) => r.qid),
      ),
    );
  for (const r of rows)
    items.set(toQid(r.qid), { ...r, qid: toQid(r.qid), kind: r.kind as MusicKind, links: [] });
  for (const l of links)
    items
      .get(toQid(l.qid))
      ?.links.push({ property: toProperty(l.property), target: toQid(l.target) });
}

/** Fetch the compositions, tracks and singles linked to (or listing) `from`. */
async function expand(from: ItemFacts[], items: Map<string, ItemFacts>): Promise<void> {
  const wanted = new Set(from.flatMap((it) => targets(it, ...RELATED_PROPERTIES)));
  const tracks = from.filter((it) => it.kind === "track").map((it) => qidNumber(it.qid));
  if (tracks.length) {
    const listing = await db
      .select({ qid: musicLinks.qid })
      .from(musicLinks)
      .where(and(eq(musicLinks.property, P658), inArray(musicLinks.target, tracks)))
      .limit(MAX_CANDIDATES);
    for (const l of listing) wanted.add(toQid(l.qid));
  }
  const missing = [...wanted].filter((q) => !items.has(q)).slice(0, MAX_CANDIDATES);
  if (missing.length === 0) return;
  const rows = await db
    .select(itemColumns)
    .from(musicItems)
    .where(
      and(inArray(musicItems.qid, missing.map(qidNumber)), inArray(musicItems.kind, MATCH_KINDS)),
    );
  await withLinks(rows, items);
}

export async function findMatches(body: Partial<MatchesRequest>): Promise<MatchesResponse> {
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .filter(
      (r): r is MatchesRequest["rows"][number] =>
        typeof r?.key === "string" && typeof r.title === "string" && Array.isArray(r.performers),
    )
    .slice(0, MAX_ROWS)
    .map((r) => ({
      key: r.key.slice(0, 32),
      title: r.title.slice(0, 400),
      performers: r.performers.filter((p): p is string => typeof p === "string" && QID.test(p)),
    }));
  const keys = [...new Set(rows.map((r) => labelSearchKey(r.title.trim())))].filter(
    (k): k is string => !!k,
  );
  const performers = [...new Set(rows.flatMap((r) => r.performers))]
    .slice(0, MAX_PERFORMERS)
    .map(qidNumber);
  const album =
    typeof body.albumQid === "string" && QID.test(body.albumQid) ? qidNumber(body.albumQid) : null;

  const albumTracks = new Set<string>();
  if (album !== null) {
    const [listed, partOf] = await Promise.all([
      db
        .select({ qid: musicLinks.target })
        .from(musicLinks)
        .where(and(eq(musicLinks.qid, album), eq(musicLinks.property, P658))),
      db
        .select({ qid: musicLinks.qid })
        .from(musicLinks)
        .where(and(eq(musicLinks.target, album), inArray(musicLinks.property, PART_OF)))
        .limit(MAX_CANDIDATES),
    ]);
    for (const r of [...listed, ...partOf]) albumTracks.add(toQid(r.qid));
  }
  if (keys.length === 0 || (performers.length === 0 && albumTracks.size === 0)) return { rows: {} };

  const linked = or(
    albumTracks.size ? inArray(musicItems.qid, [...albumTracks].map(qidNumber)) : undefined,
    performers.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(musicLinks)
            .where(
              and(
                eq(musicLinks.qid, musicItems.qid),
                inArray(musicLinks.property, CREATORS),
                inArray(musicLinks.target, performers),
              ),
            ),
        )
      : undefined,
  );
  const candidates = await db
    .select(itemColumns)
    .from(musicItems)
    .where(
      and(inArray(musicItems.labelSearch, keys), inArray(musicItems.kind, MATCH_KINDS), linked),
    )
    .limit(MAX_CANDIDATES);

  const items = new Map<string, ItemFacts>();
  await withLinks(candidates, items);
  // Twice: a single's track, then that track's composition.
  await expand([...items.values()], items);
  const direct = new Set(candidates.map((c) => toQid(c.qid)));
  await expand(
    [...items.values()].filter((it) => !direct.has(it.qid)),
    items,
  );
  return assembleMatches(rows, { items, albumTracks });
}
