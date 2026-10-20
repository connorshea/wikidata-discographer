// Filling a disc's "existing" fields from the mirror's matches
// (POST /api/items/matches). A track brings its composition along, so a
// reused track keeps the composition it already records.
import type {
  Match,
  MatchesRequest,
  MatchesResponse,
  RowMatches,
  TrackMatch,
} from "./api-types.ts";
import type { Disc, Track } from "./plan.ts";
import { SIMILAR_TITLE } from "./titles.ts";

/**
 * The reason given for a same-title item with no performer, composer or
 * lyricist. Such a match is only a guess, so it's suggested but never filled
 * in by `fillUnambiguous`.
 */
export const NO_ARTIST = "no artist set";

const isTitleReason = (r: string) => r === "same title" || r === SIMILAR_TITLE;

/** Whether a possible duplicate album's reason is a shared identifier, not its title. */
export const isIdReason = (r: string) =>
  !isTitleReason(r) && r !== "same performer" && r !== NO_ARTIST;

/**
 * Whether the match's title is only similar to the track's, not the same
 * (or it was reached through such a match). Suggested, but never filled in by
 * `fillUnambiguous`.
 */
export const isSimilarOnly = (m: Pick<Match, "reasons">) =>
  m.reasons.includes(SIMILAR_TITLE) && !m.reasons.includes("same title");

/** Whether the match is only a title with no artist, or only a similar title. */
const isGuess = (m: Match) =>
  isSimilarOnly(m) ||
  (m.reasons.includes(NO_ARTIST) && m.reasons.every((r) => isTitleReason(r) || r === NO_ARTIST));

/** A matches response, with the request it answers. */
export interface Answered {
  request: MatchesRequest;
  rows: MatchesResponse["rows"];
}

/**
 * The answered matches that still hold for `request`: those for rows whose
 * title and performers are unchanged since, while the album is the same. Rows
 * that changed drop theirs until the next response, and the rest keep showing
 * theirs meanwhile.
 */
export function stillValid(
  answered: Answered | null,
  request: MatchesRequest,
): MatchesResponse["rows"] {
  if (!answered || answered.request.albumQid !== request.albumQid) return {};
  const asked = new Map(answered.request.rows.map((r) => [r.key, r]));
  const out: MatchesResponse["rows"] = {};
  for (const r of request.rows) {
    const was = asked.get(r.key);
    const m = answered.rows[r.key];
    if (m && was?.title === r.title && was.performers.join() === r.performers.join())
      out[r.key] = m;
  }
  return out;
}

/**
 * Use `t` as track `n`'s existing track, with the composition it records (in
 * place of any other: the run links a reused track to the composition field,
 * so a different one would give it a second P2550).
 */
export function pickTrack(disc: Disc, n: number, t: TrackMatch): void {
  disc.track[n] = t.qid;
  if (t.composition) disc.comp[n] = t.composition;
}

/**
 * Fill every empty field of disc `di` that has exactly one match, and return
 * how many were filled.
 *
 * A reused track is linked to the composition field (P2550), so the two must
 * agree: a track is left out when it records a different composition than the
 * one filled in, an empty composition takes the one the track records, and
 * the composition is only filled from the row's own matches when the track is
 * new, or a matched one that records none (a track entered by hand may record
 * one this doesn't know about).
 */
export function fillUnambiguous(disc: Disc, di: number, rows: Record<string, RowMatches>): number {
  let filled = 0;
  const set = (map: Record<string, string>, n: number, qid: string) => {
    if (map[n]) return;
    map[n] = qid;
    filled++;
  };
  for (const [key, all] of Object.entries(rows)) {
    const [d, num] = key.split(":");
    if (Number(d) !== di) continue;
    const n = Number(num);
    // A similar title is never filled, so it doesn't make a same-title match ambiguous.
    const m = {
      track: all.track.filter((t) => !isSimilarOnly(t)),
      comp: all.comp.filter((c) => !isSimilarOnly(c)),
    };
    if (!disc.track[n] && m.track.length === 1 && !isGuess(m.track[0])) {
      const t = m.track[0];
      if (!t.composition || !disc.comp[n] || disc.comp[n] === t.composition) {
        set(disc.track, n, t.qid);
        if (t.composition) set(disc.comp, n, t.composition);
      }
    }
    const track = disc.track[n] ? m.track.find((t) => t.qid === disc.track[n]) : undefined;
    if (track?.composition) set(disc.comp, n, track.composition);
    const compFree = !disc.track[n] || (track !== undefined && !track.composition);
    if (compFree && m.comp.length === 1 && !isGuess(m.comp[0])) set(disc.comp, n, m.comp[0].qid);
  }
  return filled;
}

/** A field a candidate fills: the row's existing composition or track. */
export type Slot = "comp" | "track";

/** Identifies a candidate for dismissing it, e.g. "0:3:comp:Q42". */
export const candidateId = (di: number, n: number, slot: Slot, qid: string) =>
  `${di}:${n}:${slot}:${qid}`;

/** The id of a track's group in the Possible matches card, to link to it. */
export const groupId = (di: number, n: number) => `match-${di}-${n}`;

/** What's in a row's field for `slot`, or "" when it's empty. */
export function slotValue(disc: Disc, n: number, slot: Slot): string {
  return disc[slot][n]?.trim() ?? "";
}

/**
 * Whether a match ties the item to the form beyond its title: a shared
 * performer, composer or lyricist, the existing album, or a link to one that
 * does. Anything else is only a same-title item.
 */
export const isStrong = (m: Match) => m.reasons.some((r) => !isTitleReason(r) && r !== NO_ARTIST);

// The order a match's ties beyond its title are shown in, strongest first.
const TIE_ORDER = ["on this album", "same performer", "same composer or lyricist"];

/**
 * What ties a match to the form beyond its title, as chips, e.g. ["Same
 * performer"] or ["On this album", "Recorded as Q42"].
 */
export function ties(m: Pick<Match, "reasons">): string[] {
  const rank = (r: string) => {
    const i = TIE_ORDER.indexOf(r);
    return i === -1 ? TIE_ORDER.length : i;
  };
  return m.reasons
    .filter((r) => !isTitleReason(r) && r !== NO_ARTIST)
    .sort((a, b) => rank(a) - rank(b))
    .map((r) => r[0].toUpperCase() + r.slice(1));
}

// Where a description's "by …" phrase ends, e.g. "song by X from the album Y".
const BY_END =
  /\s+(?:from|on|off|for|in|at|released|recorded|written|composed|produced)\b|\s*[(;:[]/i;
const BY_SPLIT = /\s*(?:,|&|\+|\band\b|\bfeaturing\b|\bfeat\.?|\bft\.|\bwith\b|\bx\b)\s*/i;
const ACT_WORD = /\s+(?:band|group|duo|trio)$/i;
// "by" and the word before it, e.g. "performed by" or "written by".
const BY = /(?:([\p{L}-]+)[\s,]*)?\bby\s+/giu;
// The words before "by" that name who wrote or made it rather than who performs it.
const MAKER =
  /^(?:(?:co-)?written|composed|lyrics|words|music|produced|arranged|directed|video|translated|adapted)$/i;
// A description that names the artist up front, e.g. "2017 Portugal. The Man song".
const ARTIST_FIRST = /^(?:\d{4}\s+)?(.+?)\s+(?:song|single|track|recording)$/i;
// Capitalized words that describe a song rather than name its artist, as in
// "English folk song" or "Christmas song".
const DESCRIPTIVE = new Set(
  [
    "American",
    "Argentine",
    "Australian",
    "Austrian",
    "Belgian",
    "Brazilian",
    "British",
    "Canadian",
    "Chinese",
    "Christmas",
    "Colombian",
    "Croatian",
    "Czech",
    "Danish",
    "Dutch",
    "Easter",
    "English",
    "Estonian",
    "Eurovision",
    "Filipino",
    "Finnish",
    "Flemish",
    "French",
    "German",
    "Greek",
    "Halloween",
    "Hebrew",
    "Hindi",
    "Hungarian",
    "Icelandic",
    "Indian",
    "Indonesian",
    "Irish",
    "Israeli",
    "Italian",
    "J-pop",
    "Japanese",
    "K-pop",
    "Korean",
    "Latin",
    "Latvian",
    "Lithuanian",
    "Mexican",
    "New",
    "North",
    "Norwegian",
    "Polish",
    "Portuguese",
    "Romanian",
    "Russian",
    "Scottish",
    "Serbian",
    "Slovak",
    "Slovenian",
    "South",
    "Soviet",
    "Spanish",
    "Swedish",
    "Swiss",
    "Taiwanese",
    "Thai",
    "Turkish",
    "UK",
    "US",
    "Ukrainian",
    "Vietnamese",
    "Welsh",
    "Zealand",
  ].map((w) => w.toLowerCase()),
);
const squash = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The phrases a description names its performers in: what follows "by" (but
 * not "written by", "words by" and the like, which name its writers), or what
 * comes before "song" in one like "Owl City song", unless that only describes
 * it, as in "English folk song".
 */
function performerPhrases(description: string): string[] {
  const first = description.trim().match(ARTIST_FIRST)?.[1];
  if (first && !/\bby\b/i.test(first)) {
    const descriptive = first
      .split(/\s+/)
      .every((w) => !/^\p{Lu}/u.test(w) || DESCRIPTIVE.has(w.toLowerCase()));
    return descriptive ? [] : [first];
  }
  const bys = [...description.matchAll(BY)];
  return bys.flatMap((m, i) =>
    MAKER.test(m[1] ?? "")
      ? []
      : [description.slice(m.index + m[0].length, bys[i + 1]?.index).split(BY_END)[0]],
  );
}

/**
 * The artists a description names as its performers that aren't among
 * `artists`, e.g. ["the Black Keys"] for "2022 single by the Black Keys" or
 * "Black Keys song" on a track by someone else. Loose on purpose: a name
 * counts as the track's when either contains the other.
 */
export function otherArtists(description: string | null, artists: readonly string[]): string[] {
  if (!description) return [];
  const own = artists.map(squash).filter(Boolean);
  const names = performerPhrases(description)
    .flatMap((phrase) => phrase.split(BY_SPLIT))
    .map((name) =>
      name
        .replace(ACT_WORD, "")
        .replace(/[.\s]+$/, "")
        .trim(),
    )
    .filter((name) => {
      const s = squash(name);
      return s && !own.some((o) => o.includes(s) || s.includes(o));
    });
  return [...new Set(names)];
}

export interface Candidate {
  id: string;
  slot: Slot;
  match: Match | TrackMatch;
  strong: boolean;
  /** Artists the description names other than the track's. */
  others: string[];
  /** Its QID is in the row's field. */
  used: boolean;
  /** The field holds another QID, so it can't be used as it is. */
  taken: boolean;
}

export interface TrackReview {
  di: number;
  n: number;
  title: string;
  /** The candidates not dismissed. */
  candidates: Candidate[];
  dismissed: number;
  /** Every candidate left is used, or its field already holds something else. */
  reviewed: boolean;
}

/**
 * Each track's candidates and whether it's been reviewed: every candidate is
 * used, dismissed or has its field filled with something else. Using one
 * doesn't settle the rest, so a reused composition still leaves its track open.
 */
export function reviewTracks(
  discs: readonly Disc[],
  tracks: readonly (readonly Track[])[],
  rows: Record<string, RowMatches>,
  dismissed: ReadonlySet<string>,
): TrackReview[] {
  const out: TrackReview[] = [];
  tracks.forEach((discTracks, di) => {
    const disc = discs[di];
    if (!disc) return;
    for (const r of discTracks) {
      const m = rows[`${di}:${r.n}`];
      if (!m) continue;
      const all = (["comp", "track"] as const).flatMap((slot) =>
        m[slot].map((match): Candidate => {
          const value = slotValue(disc, r.n, slot);
          return {
            id: candidateId(di, r.n, slot, match.qid),
            slot,
            match,
            strong: isStrong(match),
            others: otherArtists(match.description, r.artists),
            used: value === match.qid,
            taken: value !== "" && value !== match.qid,
          };
        }),
      );
      if (!all.length) continue;
      const candidates = all.filter((c) => !dismissed.has(c.id));
      out.push({
        di,
        n: r.n,
        title: r.title,
        candidates,
        dismissed: all.length - candidates.length,
        reviewed: candidates.every((c) => c.used || c.taken),
      });
    }
  });
  return out;
}

/** The matches left once the dismissed candidates are taken out. */
export function withoutDismissed(
  rows: Record<string, RowMatches>,
  dismissed: ReadonlySet<string>,
): Record<string, RowMatches> {
  const out: Record<string, RowMatches> = {};
  for (const [key, m] of Object.entries(rows)) {
    const [di, n] = key.split(":").map(Number);
    const keep = <T extends Match>(slot: Slot, list: T[]) =>
      list.filter((x) => !dismissed.has(candidateId(di, n, slot, x.qid)));
    out[key] = {
      comp: keep("comp", m.comp),
      track: keep("track", m.track),
      single: m.single,
    };
  }
  return out;
}

/** Where a row went, as its disc index and track number, or null if it's gone. */
export type RowMove = (di: number, n: number) => readonly [number, number] | null;

/** The rows of disc `di` were renumbered, `moved` mapping old track numbers to new. */
export const renumberedRows =
  (di: number, moved: ReadonlyMap<number, number>): RowMove =>
  (d, n) => {
    if (d !== di) return [d, n];
    const to = moved.get(n);
    return to === undefined ? null : [d, to];
  };

/** Disc `di` was removed, so the discs after it move down one. */
export const removedDisc =
  (di: number): RowMove =>
  (d, n) =>
    d < di ? [d, n] : d === di ? null : [d - 1, n];

/**
 * An id that starts with its row's disc index and track number ("0:3:comp:Q1",
 * "0:3"), following the row, or null if the row is gone.
 */
export function moveRowId(id: string, move: RowMove): string | null {
  const [d, n, ...rest] = id.split(":");
  const to = move(Number(d), Number(n));
  return to && [...to, ...rest].join(":");
}

/** Ids kept by row (see `moveRowId`), following their rows. Those of rows that are gone are dropped. */
export function moveRowIds(ids: Iterable<string>, move: RowMove): Set<string> {
  const next = new Set<string>();
  for (const id of ids) {
    const to = moveRowId(id, move);
    if (to !== null) next.add(to);
  }
  return next;
}

/**
 * The candidates "Dismiss all" takes out of a track's group: every one left
 * that isn't used.
 */
export const dismissAllIds = (r: TrackReview): string[] =>
  r.candidates.filter((c) => !c.used).map((c) => c.id);

/** How the review stands, for the Possible matches header and its collapsed summary. */
export interface ReviewSummary {
  tracks: number;
  reviewed: number;
  /** Candidates used. */
  reused: number;
  /** Candidates dismissed. */
  dismissed: number;
}

export function reviewSummary(reviews: readonly TrackReview[]): ReviewSummary {
  return {
    tracks: reviews.length,
    reviewed: reviews.filter((r) => r.reviewed).length,
    reused: reviews.reduce((sum, r) => sum + r.candidates.filter((c) => c.used).length, 0),
    dismissed: reviews.reduce((sum, r) => sum + r.dismissed, 0),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (xs: string[]) =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// The order a reviewed track names what it uses: the track brings the rest along.
const SLOT_NAMES: [Slot, string][] = [
  ["track", "track"],
  ["comp", "composition"],
];

/**
 * Whether a used candidate was filled in by using the track that records it,
 * so it's undone with the track rather than on its own.
 */
export function comesWithTrack(r: TrackReview, c: Candidate): boolean {
  if (!c.used || c.slot === "track") return false;
  return r.candidates.some((t) => {
    if (t.slot !== "track" || !t.used) return false;
    const m = t.match as TrackMatch;
    return m.composition === c.match.qid;
  });
}

/**
 * A reviewed track's outcome in a line, e.g. "Using the track, Q3962408" or
 * "1 dismissed, creating new".
 */
export function reviewedLine(r: TrackReview): string {
  const used = SLOT_NAMES.flatMap(([slot, name]) =>
    r.candidates.filter((c) => c.slot === slot && c.used).map((c) => ({ name, qid: c.match.qid })),
  );
  const dismissed = r.dismissed > 0 ? `${r.dismissed} dismissed` : "";
  if (used.length) {
    const what =
      used.length === 1
        ? `Using the ${used[0].name}, ${used[0].qid}`
        : `Using the ${andList(used.map((u) => u.name))}`;
    return [what, dismissed].filter(Boolean).join(", ");
  }
  // Nothing used, so whatever's left has another QID in its field.
  if (!dismissed) return "Other QIDs are filled in";
  return `${dismissed}, ${r.candidates.length ? "other QIDs filled in" : "creating new"}`;
}

/** The review folded into a line, once every track is reviewed, e.g. "Using 4 items, 3 dismissed". */
export function summaryLine(sum: ReviewSummary): string {
  return (
    [
      sum.reused > 0 && `Using ${plural(sum.reused, "item")}`,
      sum.dismissed > 0 && `${sum.dismissed} dismissed`,
    ]
      .filter(Boolean)
      .join(", ") || "Other QIDs are filled in"
  );
}
