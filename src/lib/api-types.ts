// Wire shapes shared by the server routes and the client.
import type { MusicKind } from "./music.ts";
import type { MbForm, ReleaseChoice } from "./musicbrainz.ts";

export interface AuthUserInfo {
  id: number;
  username: string;
  blocked: boolean;
}

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

export interface SearchResponse {
  items: MirrorItem[];
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
  item: MirrorItem;
}

/** GET /api/items/:qid/tracklist: the item's tracks (P658) on Wikidata now. */
export interface TracklistResponse {
  tracks: string[];
  /** Which of `tracks` this app's runs created for the album. */
  madeHere: string[];
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
  edits: EditLogEntry[];
}

/** Body of POST /api/submissions. */
export interface SubmissionRequest {
  state: unknown;
  /** The id of the user's "unknown" run, once they've checked its item wasn't created. */
  confirmUnknown?: number;
}

/**
 * The 409 from POST /api/submissions while the user's last run ended
 * "unknown" and the form doesn't use the item it may have created.
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
  submissions: Omit<SubmissionInfo, "edits" | "total">[];
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
