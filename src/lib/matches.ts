// Filling a disc's "existing" fields from the mirror's matches
// (POST /api/items/matches). A track brings its composition and single along,
// so a reused track keeps the composition it already records.
import type { RowMatches, TrackMatch } from "./api-types.ts";
import type { Disc } from "./plan.ts";

/** Use `t` as track `n`'s existing track, and fill in what it links to where empty. */
export function pickTrack(disc: Disc, n: number, t: TrackMatch): void {
  disc.track[n] = t.qid;
  if (!disc.comp[n] && t.composition) disc.comp[n] = t.composition;
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
    if (!disc.track[n] && m.track.length === 1) {
      const t = m.track[0];
      set(disc.track, n, t.qid);
      if (t.composition) set(disc.comp, n, t.composition);
    }
    if (m.comp.length === 1) set(disc.comp, n, m.comp[0].qid);
    const sg = disc.single[n];
    if (sg && !sg.qid) {
      const track = m.track.find((t) => t.qid === disc.track[n]);
      const qid = track?.singles.length === 1 ? track.singles[0] : m.single[0]?.qid;
      if (qid && (track?.singles.length === 1 || m.single.length === 1)) {
        sg.qid = qid;
        filled++;
      }
    }
  }
  return filled;
}
