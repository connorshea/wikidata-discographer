import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { foreignTracks, QID, type State } from "../lib/plan.ts";
import type { TracklistResponse } from "../lib/api-types.ts";
import { useDebounced } from "./use-debounced.ts";

/** An existing album that already has a tracklist of its own, which blocks the run. */
export interface AlbumTracklist {
  qid: string;
  /** Listed tracks (P658) that block the run (see `foreignTracks`). */
  foreign: string[];
}

/**
 * Whether the existing album already has a tracklist, asked of Wikidata once
 * its QID settles. Null while unknown, or if it couldn't be asked: the server
 * checks again before a run starts.
 */
export function useAlbumTracklist(state: State): AlbumTracklist | null {
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
  if (!qid || qid !== typed || result?.qid !== qid) return null;
  const foreign = foreignTracks(state, result.tracks, result.madeHere);
  return foreign.length ? { qid, foreign } : null;
}
