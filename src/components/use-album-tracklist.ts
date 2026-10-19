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
  /** Whether Wikidata was asked about the album's QID as it is now. */
  checked: boolean;
  /** Whether the album's QID is still waiting on an answer (not once asking failed). */
  pending: boolean;
  /** Set if the album already has a tracklist. */
  tracklist: AlbumTracklist | null;
  /**
   * Its MusicBrainz release group (P436), to suggest loading it, if it has
   * exactly one and no tracklist.
   */
  releaseGroup: string | null;
}

const UNKNOWN: ExistingAlbum = {
  checked: false,
  pending: false,
  tracklist: null,
  releaseGroup: null,
};

/**
 * Whether the existing album already has a tracklist, and its release group,
 * asked of Wikidata once its QID settles. Both null while unknown, or if it
 * couldn't be asked: the server checks the tracklist again before a run starts.
 */
export function useAlbumTracklist(state: State): ExistingAlbum & {
  /** Ask Wikidata again, for an album fixed on Wikidata since. */
  reload: () => void;
} {
  const typed = state.album.mode === "existing" ? state.album.qid.trim() : "";
  const qid = useDebounced(QID.test(typed) ? typed : "");
  // Tagged with the QID they answer, so a stale answer is never used. Null if asking failed.
  const [result, setResult] = useState<{ qid: string; answer: TracklistResponse | null } | null>(
    null,
  );
  // Bumped to ask again about the same QID.
  const [asked, setAsked] = useState(0);
  const reload = () => {
    setResult(null);
    setAsked((n) => n + 1);
  };
  useEffect(() => {
    if (!qid) return;
    let cancelled = false;
    api<TracklistResponse>(`/api/items/${qid}/tracklist`)
      .then((answer) => !cancelled && setResult({ qid, answer }))
      .catch(() => !cancelled && setResult({ qid, answer: null }));
    return () => {
      cancelled = true;
    };
  }, [qid, asked]);
  return { ...existingAlbum(typed, qid, result), reload };
}

function existingAlbum(
  typed: string,
  qid: string,
  result: { qid: string; answer: TracklistResponse | null } | null,
): ExistingAlbum {
  if (!QID.test(typed)) return UNKNOWN;
  if (qid !== typed || result?.qid !== qid) return { ...UNKNOWN, pending: true };
  const r = result.answer;
  if (!r) return UNKNOWN;
  if (r.tracks.length)
    return {
      checked: true,
      pending: false,
      tracklist: { qid, tracks: r.tracks },
      releaseGroup: null,
    };
  // More than one is usually a mistake on the item: suggest none of them.
  return {
    checked: true,
    pending: false,
    tracklist: null,
    releaseGroup: r.releaseGroups.length === 1 ? r.releaseGroups[0] : null,
  };
}
