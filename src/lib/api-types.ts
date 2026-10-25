// Wire shapes shared by the server routes and the client.
import type { MusicKind } from "./music.ts";
import type { MbForm, ReleaseChoice } from "./musicbrainz.ts";
import type { State } from "./plan.ts";

export interface AuthUserInfo {
  id: number;
  username: string;
  /** Whether a run would be refused for the account's age or edit count. */
  eligibility: EditEligibility;
}

/** Whether the user's account may create items with this tool (see server/auth/eligibility.ts). */
export type EditEligibility =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /** ISO time the account becomes old enough, while that is what refuses it. */
      retryAt?: string;
    };

export interface AuthMeResponse {
  user: AuthUserInfo | null;
  /** False when the server has no OAuth consumer configured (login is unavailable). */
  configured: boolean;
  /** Origin of the Wikidata instance edits go to, e.g. "https://test.wikidata.org". */
  wikiBaseUrl: string;
}

export interface LogoutResponse {
  ok: true;
}

export interface MirrorItem {
  qid: string;
  kind: MusicKind;
  label: string | null;
  description: string | null;
}

/** A search result. Albums and EPs also say what the mirror knows of their tracklist. */
export interface SearchItem extends MirrorItem {
  album?: AlbumFacts;
}

export interface AlbumFacts {
  /** How many tracks its tracklist (P658) lists, as of the mirror. */
  tracks: number;
  /** Whether it has a MusicBrainz release group ID (P436). */
  musicBrainz: boolean;
}

export interface SearchResponse {
  items: SearchItem[];
}

/** Body of POST /api/items/duplicates. */
export interface DuplicatesRequest {
  title: string;
  kinds: MusicKind[];
  /** property → value, e.g. { P2205: "4aawyAB9vmqN3uQ7FjRGTy" } */
  ids: Record<string, string>;
  /** The album artists' QIDs. Same-title albums by someone else are left out once there are any. */
  performers: string[];
}

export interface DuplicateMatch extends MirrorItem {
  /** Why it matched: the shared identifiers, or "same title" and how its performer compares. */
  reasons: string[];
}

export interface DuplicatesResponse {
  matches: DuplicateMatch[];
}

export interface AddItemResponse {
  /** With its album facts as of the refreshed mirror, if it's an album or EP. */
  item: SearchItem;
}

/** GET /api/items/:qid/tracklist: the item's tracks (P658) on Wikidata now. */
export interface TracklistResponse {
  tracks: string[];
  /** Its MusicBrainz release group IDs (P436), lowercased. */
  releaseGroups: string[];
}

export interface EditLogEntry {
  op: "create" | "addClaims";
  key: string | null;
  kind: string | null;
  what: string;
  qid: string | null;
  revid: number | null;
  ok: boolean;
  /** A create that got no answer and may have been saved (`qid` if it turned up later). */
  unknown: boolean;
  skipped: number;
  error: string | null;
}

/** "unknown": a create got no answer, so the item may exist; see `UnknownRunConflict`. */
export type SubmissionStatus = "running" | "done" | "failed" | "interrupted" | "unknown";

export interface SubmissionInfo {
  id: number;
  status: SubmissionStatus;
  title: string;
  albumQid: string | null;
  editGroupUrl: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Operations in the plan, so the client can show progress. */
  total: number;
  /** While the run waits before its next edit (they go out two or three seconds apart): when it goes. */
  waitingUntil: string | null;
  edits: EditLogEntry[];
  /** The form the run was started from, so the client can tell whether it's still the one open. */
  input: State;
}

/** Body of POST /api/submissions. */
export interface SubmissionRequest {
  state: unknown;
  /** The id of the user's "unknown" run, once they've checked its item wasn't created (or, if found, was deleted since). */
  confirmUnknown?: number;
  /** The id of the user's last run, once they've said to create its items again. */
  confirmRecreate?: number;
}

/**
 * The 409 from POST /api/submissions when the run would create items for the
 * same album that the user's last run already created, e.g. a form run again
 * from another browser, which never got that run's QIDs.
 */
export interface RecreateConflict {
  error: string;
  recreate: {
    /** The last run. */
    id: number;
    editGroupUrl: string;
    /** What it created that this run would create again, by plan key, to write back with `applyCreated`. */
    created: { key: string; qid: string; what: string }[];
  };
}

/**
 * The 409 from POST /api/submissions while the user's last run ended
 * "unknown" and the form may create the item it made again: always while the
 * item can't be found, and once it's found, only if the form would create it
 * again (the same plan key, with the same labels, for the same album).
 */
export interface UnknownRunConflict {
  error: string;
  unknownRun: {
    id: number;
    /** The create, e.g. "track “Intro”". */
    what: string;
    /** Its plan key, e.g. "track:0:3", to write `qid` back into the form. */
    key: string | null;
    editGroupUrl: string;
    /** The item, if it has turned up since; null if it still can't be found. */
    qid: string | null;
  };
}

export interface SubmissionListResponse {
  submissions: Omit<SubmissionInfo, "edits" | "total" | "waitingUntil" | "input">[];
}

/** One run in the album list. */
export interface AlbumRun {
  id: number;
  status: SubmissionStatus;
  username: string;
  /** Whether the logged-in user made it, so it can open in the run view. */
  mine: boolean;
  createdAt: string;
  finishedAt: string | null;
  editGroupUrl: string;
  /** Items the run created, the album included. */
  created: number;
  /** Whether this run created the album, not just added to it. */
  createdAlbum: boolean;
}

/** An album the tool created or added a tracklist to, with its runs, newest first. */
export interface AlbumListEntry {
  qid: string;
  /** The label in the mirror, else the title the latest run was given. */
  label: string;
  /** Its performers' labels, as of the mirror. */
  artists: string[];
  /** Whether the tool created the album, not just added to an existing one. */
  created: boolean;
  runs: AlbumRun[];
}

/** GET /api/albums. */
export interface AlbumListResponse {
  albums: AlbumListEntry[];
  /** Pass as `before` for the next page, or null on the last page. */
  next: number | null;
}

/** An artist found by GET /api/artists/search. */
export interface ArtistResult extends MirrorItem {
  /** How many albums and EPs in the mirror have it as performer (P175). */
  albums: number;
}

export interface ArtistSearchResponse {
  artists: ArtistResult[];
}

/** One of an artist's albums or EPs, as of the mirror. */
export interface ArtistAlbum {
  qid: string;
  label: string | null;
  /** "Album", "EP", "Live album" and so on (albumType, src/lib/music.ts). */
  type: string;
  /** The earliest publication date: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  released: string | null;
  /** How many tracks its tracklist (P658) lists. */
  tracks: number;
  /** How many tracks its number of parts (P2635) says it has. */
  parts: number | null;
  /** Its MusicBrainz release group IDs (P436). */
  releaseGroups: string[];
  /** The latest Discographer run on it. */
  run: Pick<AlbumRun, "id" | "status" | "mine" | "createdAt" | "editGroupUrl"> | null;
}

/** One of an artist's singles, as of the mirror. */
export interface ArtistSingle {
  qid: string;
  label: string | null;
  /** The earliest publication date: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  released: string | null;
  /** How many tracks its tracklist (P658) lists. */
  tracks: number;
  /** The albums it's taken from (P13602), by label. Not always the artist's. */
  takenFrom: { qid: string; label: string | null }[];
}

/** GET /api/artists/:qid: the artist and its albums, EPs and singles, oldest first. */
export interface ArtistResponse {
  artist: {
    qid: string;
    label: string | null;
    description: string | null;
    /** Its MusicBrainz artist IDs (P434), as of the mirror. */
    musicBrainzIds: string[];
  };
  albums: ArtistAlbum[];
  /** Whether there were more albums than the server sends. */
  truncated: boolean;
  singles: ArtistSingle[];
  /** Whether there were more singles than the server sends. */
  singlesTruncated: boolean;
}

/** Body of POST /api/items/matches: the tracklist rows to find existing items for. */
export interface MatchesRequest {
  /** The existing album being added to, or "" when creating one. */
  albumQid: string;
  rows: {
    /** "disc:track", e.g. "0:3". */
    key: string;
    title: string;
    /** The row's performer QIDs. */
    performers: string[];
    /** The row's P1552 recording types, e.g. live recording. Optional for older clients. */
    recTypes?: string[];
  }[];
}

export interface Match extends MirrorItem {
  /** Why it matched, e.g. "same title", "same performer", "on this album". */
  reasons: string[];
}

export interface TrackMatch extends Match {
  /** The composition it's a recording of (P2550), if the mirror knows one. */
  composition: string | null;
  /** Singles it's on (its P1433/P361, or their P658). */
  singles: string[];
  /** For a live row, it doesn't say whether it's a live or studio recording (P1552), so it may be a studio one. */
  recordingUnknown?: true;
}

export interface RowMatches {
  comp: Match[];
  track: TrackMatch[];
  single: Match[];
}

export interface MatchesResponse {
  /** By request row key; rows with no matches are left out. */
  rows: Record<string, RowMatches>;
}

/** What an item is called and what it's an instance of, or why it can't be shown. */
export type ItemSummary =
  | { status: "ok"; label: string | null; description: string | null; classes: string[] }
  | { status: "missing" }
  | { status: "redirect"; to: string };

/** Body of POST /api/items/describe. */
export interface DescribeRequest {
  qids: string[];
  /** The language for labels and descriptions, with Wikidata's fallbacks. */
  lang: string;
}

export interface DescribeResponse {
  /** By QID, each one asked for. */
  items: Record<string, ItemSummary>;
}

/** GET /api/musicbrainz/release/:mbid: the form values for a MusicBrainz release. */
export interface MusicBrainzResponse {
  form: MbForm;
}

/** GET /api/musicbrainz/release-group/:mbid: its releases, best guess first. */
export interface MusicBrainzReleaseGroupResponse {
  releases: ReleaseChoice[];
  /** How many releases the group has (official ones, if it has any). At most 300 are listed. */
  total: number;
}
