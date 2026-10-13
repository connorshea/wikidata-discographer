// Which same-title albums to suggest as possible duplicates of a new album
// (POST /api/items/duplicates). Like a track row's matches (server/matches.ts),
// a title alone is too common to go on: an album by someone else with the same
// title is suggested only when the album artists have no QIDs yet to compare.
import { isIdReason, isSimilarOnly, NO_ARTIST } from "../src/lib/matches.ts";
import type { DuplicateMatch } from "../src/lib/api-types.ts";

/**
 * Why a same-title album might be this one, given its performers (P175) and
 * the new album's artists, or null if it's by someone else. `title` is
 * "same title", or "similar title" when the titles only match once folded.
 */
export function titleReasons(
  credited: string[],
  artists: string[],
  title = "same title",
): string[] | null {
  if (artists.length === 0) return [title];
  if (credited.some((q) => artists.includes(q))) return [title, "same performer"];
  if (credited.length === 0) return [title, NO_ARTIST];
  return null;
}

const score = (m: DuplicateMatch) =>
  (m.reasons.some(isIdReason) ? 10 : 0) +
  (m.reasons.includes("same performer") ? 2 : 0) -
  (m.reasons.includes(NO_ARTIST) ? 1 : 0) -
  (isSimilarOnly(m) ? 1 : 0);

/** Identifier matches first (near-certain duplicates), then the same performer, then no artist. */
export const rankDuplicates = (matches: DuplicateMatch[]) =>
  matches.sort((a, b) => score(b) - score(a));
