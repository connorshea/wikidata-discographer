// Filling a disc's "existing" fields from the mirror's matches
// (POST /api/items/matches). A track brings its composition and single along,
// so a reused track keeps the composition it already records.
import type {
  Match,
  MatchesRequest,
  MatchesResponse,
  RowMatches,
  TrackMatch,
} from "./api-types.ts";
import type { Disc, Row } from "./plan.ts";

/**
 * The reason given for a same-title item with no performer, composer or
 * lyricist. Such a match is only a guess, so it's suggested but never filled
 * in by `fillUnambiguous`.
 */
export const NO_ARTIST = "no artist set";

/** Whether a possible duplicate album's reason is a shared identifier, not its title. */
export const isIdReason = (r: string) =>
  r !== "same title" && r !== "same performer" && r !== NO_ARTIST;

/** Whether the match is only a same-title item with no artist. */
const isGuess = (m: Match) =>
  m.reasons.includes(NO_ARTIST) && m.reasons.every((r) => r === "same title" || r === NO_ARTIST);

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
 * so a different one would give it a second P2550), and its single where empty.
 */
export function pickTrack(disc: Disc, n: number, t: TrackMatch): void {
  disc.track[n] = t.qid;
  if (t.composition) disc.comp[n] = t.composition;
  const sg = disc.single[n];
  if (sg && !sg.qid && t.singles.length === 1) sg.qid = t.singles[0];
}

/** Use `qid` as track `n`'s single, adding the single if it has none. */
export function pickSingle(disc: Disc, n: number, qid: string): void {
  disc.single[n] = { date: disc.single[n]?.date ?? "", qid };
}

/**
 * Fill every empty field of disc `di` that has exactly one match, and return
 * how many were filled. A single is only filled in for a track already marked
 * as having one: an existing single isn't reason enough to add it to the run.
 *
 * A reused track is linked to the composition field (P2550), so the two must
 * agree: a track is left out when it records a different composition than the
 * one filled in, and the composition is only filled from the row's own
 * matches when the track is new, or a matched one that records none (a track
 * entered by hand may record one this doesn't know about).
 */
export function fillUnambiguous(disc: Disc, di: number, rows: Record<string, RowMatches>): number {
  let filled = 0;
  const set = (map: Record<string, string>, n: number, qid: string) => {
    if (map[n]) return;
    map[n] = qid;
    filled++;
  };
  for (const [key, m] of Object.entries(rows)) {
    const [d, num] = key.split(":");
    if (Number(d) !== di) continue;
    const n = Number(num);
    if (!disc.track[n] && m.track.length === 1 && !isGuess(m.track[0])) {
      const t = m.track[0];
      if (!t.composition || !disc.comp[n] || disc.comp[n] === t.composition) {
        set(disc.track, n, t.qid);
        if (t.composition) set(disc.comp, n, t.composition);
      }
    }
    const track = disc.track[n] ? m.track.find((t) => t.qid === disc.track[n]) : undefined;
    const compFree = !disc.track[n] || (track !== undefined && !track.composition);
    if (compFree && m.comp.length === 1 && !isGuess(m.comp[0])) set(disc.comp, n, m.comp[0].qid);
    const sg = disc.single[n];
    if (sg && !sg.qid) {
      const qid = track?.singles.length === 1 ? track.singles[0] : m.single[0]?.qid;
      if (
        qid &&
        (track?.singles.length === 1 || (m.single.length === 1 && !isGuess(m.single[0])))
      ) {
        sg.qid = qid;
        filled++;
      }
    }
  }
  return filled;
}

/** A field a candidate fills: the row's existing composition, track or single. */
export type Slot = keyof RowMatches;

/** Identifies a candidate for dismissing it, e.g. "0:3:comp:Q42". */
export const candidateId = (di: number, n: number, slot: Slot, qid: string) =>
  `${di}:${n}:${slot}:${qid}`;

/** What's in a row's field for `slot`, or "" when it's empty. */
export function slotValue(disc: Disc, n: number, slot: Slot): string {
  return (slot === "single" ? disc.single[n]?.qid : disc[slot][n])?.trim() ?? "";
}

/**
 * Whether a match ties the item to the form beyond its title: a shared
 * performer, composer or lyricist, the existing album, or a link to one that
 * does. Anything else is only a same-title item.
 */
export const isStrong = (m: Match) => m.reasons.some((r) => r !== "same title" && r !== NO_ARTIST);

// Where a description's "by …" phrase ends, e.g. "song by X from the album Y".
const BY_END =
  /\s+(?:from|on|off|for|in|at|released|recorded|written|composed|produced)\b|\s*[(;:[]/i;
const BY_SPLIT = /\s*(?:,|&|\+|\band\b|\bfeat\.?|\bft\.|\bfeaturing\b|\bwith\b|\bx\b)\s*/i;
const ACT_WORD = /\s+(?:band|group|duo|trio)$/i;
const squash = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The artists a description names after "by" that aren't among `artists`, e.g.
 * ["the Black Keys"] for "2022 single by the Black Keys" on a track by
 * someone else. Loose on purpose: a name counts as the track's when either
 * contains the other.
 */
export function otherArtists(description: string | null, artists: readonly string[]): string[] {
  const by = description?.match(/\bby\s+(.+)$/i)?.[1];
  if (!by) return [];
  const own = artists.map(squash).filter(Boolean);
  return by
    .split(BY_END)[0]
    .split(BY_SPLIT)
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
  /** A candidate is used, or none is left to decide on. */
  reviewed: boolean;
}

/**
 * Each track's candidates and whether it's been reviewed: a candidate is
 * used, or every one is dismissed or has its field filled with something else.
 */
export function reviewTracks(
  discs: readonly Disc[],
  parsed: readonly (readonly Row[])[],
  rows: Record<string, RowMatches>,
  dismissed: ReadonlySet<string>,
): TrackReview[] {
  const out: TrackReview[] = [];
  parsed.forEach((tracks, di) => {
    const disc = discs[di];
    if (!disc) return;
    for (const r of tracks) {
      if (r.error !== undefined) continue;
      const m = rows[`${di}:${r.n}`];
      if (!m) continue;
      const all = (["comp", "track", "single"] as const).flatMap((slot) =>
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
        reviewed: all.some((c) => c.used) || candidates.every((c) => c.taken),
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
      single: keep("single", m.single),
    };
  }
  return out;
}
