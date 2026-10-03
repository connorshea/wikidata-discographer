// Wire shapes shared by the server routes and the client.
import type { MusicKind } from "./music.ts";

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
}

export interface DuplicateMatch extends MirrorItem {
  /** Why it matched: the shared identifiers, or "same title". */
  reasons: string[];
}

export interface DuplicatesResponse {
  matches: DuplicateMatch[];
}

export interface AddItemResponse {
  item: MirrorItem;
}

export interface EditLogEntry {
  op: "create" | "addClaims";
  key: string | null;
  kind: string | null;
  what: string;
  qid: string | null;
  revid: number | null;
  ok: boolean;
  skipped: number;
  error: string | null;
}

export type SubmissionStatus = "running" | "done" | "failed" | "interrupted";

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
