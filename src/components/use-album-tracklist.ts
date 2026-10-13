import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { QID, type State } from "../lib/plan.ts";
import type { TracklistResponse } from "../lib/api-types.ts";
import { useDebounced } from "./use-debounced.ts";

/** An existing album that already has a tracklist of its own, which blocks the run. */
export interface AlbumTracklist {
  qid: string;
  /** The tracks it lists (P658). */
  tracks: string[];
}

export interface ExistingAlbum {
  /** Set if the album already has a tracklist. */
  tracklist: AlbumTracklist | null;
  /**
   * Its MusicBrainz release group (P436), to suggest loading it, if it has
   * exactly one and no tracklist.
   */
  releaseGroup: string | null;
}

const UNKNOWN: ExistingAlbum = { tracklist: null, releaseGroup: null };

/**
 * Whether the existing album already has a tracklist, and its release group,
 * asked of Wikidata once its QID settles. Both null while unknown, or if it
 * couldn't be asked: the server checks the tracklist again before a run starts.
 */
export function useAlbumTracklist(state: State): ExistingAlbum {
  const typed = state.album.mode === "existing" ? state.album.qid.trim() : "";
  const qid = useDebounced(QID.test(typed) ? typed : "");
  // Tagged with the QID they answer, so a stale answer is never used.
  const [result, setResult] = useState<({ qid: string } & TracklistResponse) | null>(null);
  useEffect(() => {
    if (!qid) return;
    let cancelled = false;
    api<TracklistResponse>(`/api/items/${qid}/tracklist`)
      .then((r) => !cancelled && setResult({ qid, ...r }))
      .catch(() => !cancelled && setResult(null));
    return () => {
      cancelled = true;
    };
  }, [qid]);
  if (!qid || qid !== typed || result?.qid !== qid) return UNKNOWN;
  if (result.tracks.length)
    return { tracklist: { qid, tracks: result.tracks }, releaseGroup: null };
  // More than one is usually a mistake on the item: suggest none of them.
  return {
    tracklist: null,
    releaseGroup: result.releaseGroups.length === 1 ? result.releaseGroups[0] : null,
  };
}
