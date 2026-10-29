// The artists the Artists page suggests while nothing is typed: the artist
// pages opened in this browser, kept in localStorage so nothing about what
// the user looked at goes to the server, and the artists of the user's latest
// runs (GET /api/artists/recent). One list, newest first.
import type { RecentArtist } from "./api-types.ts";
import { QID } from "./plan.ts";

export const VIEWED_ARTISTS_KEY = "discographer:viewedArtists";

/** The most artists suggested, and kept as viewed. */
export const RECENT_SHOWN = 8;

/** An artist page opened in this browser. */
export interface ViewedArtist {
  qid: string;
  label: string | null;
  /** When, as an ISO date. */
  at: string;
}

/** A suggested artist: `album` is the run's when it's there for one, null when it was viewed. */
export interface Recent {
  qid: string;
  label: string | null;
  /** When it was viewed or the run started, in ms. */
  at: number;
  album: RecentArtist["album"] | null;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** The saved artists, leaving out any that aren't one. */
export function parseViewed(raw: string | null): ViewedArtist[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.flatMap((o: unknown) => {
      if (typeof o !== "object" || o === null) return [];
      const { qid, label, at } = o as Partial<ViewedArtist>;
      return typeof qid === "string" &&
        QID.test(qid) &&
        (label === null || typeof label === "string") &&
        typeof at === "string" &&
        !Number.isNaN(Date.parse(at))
        ? [{ qid, label, at }]
        : [];
    });
  } catch {
    return [];
  }
}

export function loadViewed(store: Store = localStorage): ViewedArtist[] {
  try {
    return parseViewed(store.getItem(VIEWED_ARTISTS_KEY));
  } catch {
    return [];
  }
}

/** Keep the artist as the newest viewed, once. */
export function addViewed(
  artist: { qid: string; label: string | null },
  now = new Date(),
  store: Store = localStorage,
): void {
  try {
    const viewed = [
      { qid: artist.qid, label: artist.label, at: now.toISOString() },
      ...loadViewed(store).filter((v) => v.qid !== artist.qid),
    ].slice(0, RECENT_SHOWN);
    store.setItem(VIEWED_ARTISTS_KEY, JSON.stringify(viewed));
  } catch {
    // storage blocked: the artist just isn't suggested
  }
}

/** A run's time, stored in UTC as "YYYY-MM-DD HH:MM:SS", in ms. */
export const utcTime = (createdAt: string) => Date.parse(`${createdAt.replace(" ", "T")}Z`);

/** The viewed and edited artists, newest first, each once, at most RECENT_SHOWN. */
export function mergeRecent(viewed: ViewedArtist[], edited: RecentArtist[]): Recent[] {
  const all: Recent[] = [
    ...viewed.map((v) => ({ qid: v.qid, label: v.label, at: Date.parse(v.at), album: null })),
    ...edited.map((e) => ({ qid: e.qid, label: e.label, at: utcTime(e.at), album: e.album })),
  ]
    .filter((r) => !Number.isNaN(r.at))
    .sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return all.filter((r) => !seen.has(r.qid) && !!seen.add(r.qid)).slice(0, RECENT_SHOWN);
}
