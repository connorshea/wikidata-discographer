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
import type { Disc } from "./plan.ts";

/**
 * The reason given for a same-title item with no performer, composer or
 * lyricist. Such a match is only a guess, so it's suggested but never filled
 * in by `fillUnambiguous`.
 */
export const NO_ARTIST = "no artist set";

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

/** The matches still worth showing for track `n`: those for fields left empty. */
export function openMatches(disc: Disc, n: number, m: RowMatches | undefined): RowMatches | null {
  if (!m) return null;
  const open: RowMatches = {
    comp: disc.comp[n] ? [] : m.comp,
    track: disc.track[n] ? [] : m.track,
    single: disc.single[n]?.qid ? [] : m.single,
  };
  return open.comp.length || open.track.length || open.single.length ? open : null;
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
