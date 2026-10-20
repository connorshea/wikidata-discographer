// Editing a disc's rows by hand: lengths as typed, and adding, removing and
// moving rows. A row's track number is its key in the disc's composition
// and track maps, so whatever renumbers the rows moves those along.
import type { Disc, Track } from "./plan.ts";

const LENGTH = /^(?:(\d+):([0-5]\d)|(\d{1,3})):([0-5]\d)$/;

/** A length typed as m:ss or h:mm:ss, in seconds. Blank is no length, and anything else is an error. */
export function parseLength(raw: string): { ok: true; seconds: number | null } | { ok: false } {
  const s = raw.trim();
  if (!s) return { ok: true, seconds: null };
  const m = LENGTH.exec(s);
  if (!m) return { ok: false };
  const [, h, hm, mm, ss] = m;
  return { ok: true, seconds: h ? +h * 3600 + +hm * 60 + +ss : +mm * 60 + +ss };
}

/** Seconds as m:ss, or h:mm:ss from an hour up. "" for no length. */
export function formatLength(sec: number | null): string {
  if (sec === null) return "";
  const ss = String(sec % 60).padStart(2, "0");
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}:${ss}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss}`;
}

/** What the length cell shows: the length as typed, or else as imported. */
export const lengthText = (t: Track) => t.length ?? formatLength(t.seconds);

/** A row with nothing in it yet, numbered `n`. */
export const blankTrack = (n: number): Track => ({
  n,
  title: "",
  artists: [],
  seconds: null,
  mb: null,
});

/** How the rows were renumbered, old track number to new. */
export type Renumbered = Map<number, number>;

/**
 * Number the rows 1, 2, 3… in `order` (the rows as they now stand, by index),
 * moving each row's composition and track along with it. A map entry
 * for a row that's gone is dropped.
 */
function renumber(disc: Disc, order: Track[]): Renumbered {
  const moved: Renumbered = new Map();
  order.forEach((t, i) => t.n >= 0 && moved.set(t.n, i + 1));
  const remap = <V>(map: Record<string, V>) => {
    const next: Record<string, V> = {};
    for (const [k, v] of Object.entries(map)) {
      const n = moved.get(Number(k));
      if (n !== undefined) next[n] = v;
    }
    return next;
  };
  disc.comp = remap(disc.comp);
  disc.track = remap(disc.track);
  disc.tracks = order.map((t, i) => ({ ...t, n: i + 1 }));
  return moved;
}

/** Add a blank row at the end, numbered after the last. */
export function addTrack(disc: Disc): void {
  const last = disc.tracks.at(-1)?.n ?? 0;
  disc.tracks.push(blankTrack(last + 1));
}

/** Insert rows after the row at index `i` (or first, when -1), renumbering the disc. The
 * new rows aren't in what it returns. */
export function insertTracks(disc: Disc, i: number, rows: Omit<Track, "n">[]): Renumbered {
  const order = [...disc.tracks];
  order.splice(i + 1, 0, ...rows.map((r) => ({ ...r, n: -1 })));
  return renumber(disc, order);
}

/** Remove the row at index `i`, renumbering the rest. */
export function removeTrack(disc: Disc, i: number): Renumbered {
  return renumber(
    disc,
    disc.tracks.filter((_, j) => j !== i),
  );
}

/** Move the row at index `from` to index `to`, renumbering the disc. */
export function moveTrack(disc: Disc, from: number, to: number): Renumbered {
  const order = [...disc.tracks];
  const [row] = order.splice(from, 1);
  order.splice(to, 0, row);
  return renumber(disc, order);
}

const LEADING_NUMBER = /^\s*\d{1,3}\s*[.)]\s+/;
const TRAILING_LENGTH = [
  /\s*\((\d{1,3}:\d{2}(?::\d{2})?)\)\s*$/,
  /\s+[-–—]\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/,
];

/**
 * A pasted list with a track per line, as rows: "1. Title (3:14)",
 * "Title - 3:14" or spreadsheet columns ("1⇥Title⇥3:14") all work. A
 * leading track number is dropped and a length at the end is kept. Null
 * for a single line, which pastes as usual.
 */
export function pastedTracks(text: string): { title: string; length: string }[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  return lines.map((line) => {
    let length = "";
    let title: string;
    if (line.includes("\t")) {
      const cols = line.split("\t").map((c) => c.trim());
      if (cols.length > 1 && /^\d{1,3}\.?$/.test(cols[0])) cols.shift();
      if (cols.length > 1 && parseLength(cols.at(-1)!).ok) length = cols.pop()!;
      title = cols.filter(Boolean).join(" ");
    } else {
      title = line.replace(LEADING_NUMBER, "");
      for (const re of TRAILING_LENGTH) {
        const m = re.exec(title);
        if (m) {
          length = m[1];
          title = title.slice(0, m.index);
          break;
        }
      }
    }
    return { title: title.trim(), length };
  });
}

/** Who a row credits beyond the artists on every track, as the track table lists them. */
export interface RowPerformers {
  /** The row's own artists, when it leaves out one of those on every track. */
  only: string[];
  /** Artists on top of those on every track. */
  with: string[];
  /** Featured artists who aren't on every track. */
  feat: string[];
}

/**
 * How a row's artists differ from `base`, the artists the table lists once
 * above it: nothing to list when they're the same.
 */
export function rowPerformers(t: Pick<Track, "artists" | "feat">, base: string[]): RowPerformers {
  const featured = new Set(t.feat ?? []);
  const main = t.artists.filter((a) => !featured.has(a));
  const feat = t.artists.filter((a) => featured.has(a) && !base.includes(a));
  if (!main.length && !feat.length) return { only: [], with: [], feat: [] };
  if (base.every((b) => main.includes(b)))
    return { only: [], with: main.filter((a) => !base.includes(a)), feat };
  return { only: main, with: [], feat };
}

/** The main artists on every row that has any, or none. */
export function commonArtists(rows: Pick<Track, "artists" | "feat">[]): string[] {
  const credited = rows.filter((t) => t.artists.length);
  if (!credited.length) return [];
  const main = (t: Pick<Track, "artists" | "feat">) =>
    t.artists.filter((a) => !(t.feat ?? []).includes(a));
  return main(credited[0]).filter((a) => credited.every((t) => main(t).includes(a)));
}
