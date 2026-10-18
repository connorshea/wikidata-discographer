// Starting the form from the artist page's "Add tracklist" (src/components/ArtistPage.tsx).
import { MBID_RE } from "./musicbrainz.ts";
import { QID, type State } from "./plan.ts";
import { EMPTY } from "./state.ts";

/**
 * The album the form was linked to start from: ?album=<qid>, and &rg=<mbid>
 * to load its MusicBrainz release group. Null if there's none, or it isn't a QID.
 */
export function artistStart(search: string): { album: string; rg: string | null } | null {
  const params = new URLSearchParams(search);
  const album = params.get("album")?.toUpperCase() ?? "";
  if (!QID.test(album)) return null;
  const rg = params.get("rg")?.toLowerCase() ?? "";
  return { album, rg: MBID_RE.test(rg) ? rg : null };
}

/** A new form started from an existing album, as the Existing album QID card does. */
export function existingAlbum(qid: string): State {
  const next = structuredClone(EMPTY);
  next.album.mode = "existing";
  next.album.qid = qid;
  next.start = "existing";
  return next;
}
