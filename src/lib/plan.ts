// Turns the form state into an ordered list of Wikidata operations, following
// the WikiProject Music model:
//
//   album —P658 tracklist→ track —P2550 recording or performance of→ composition
//
// The client runs this on every keystroke to show errors and a preview; the
// server runs it again on the submitted state and executes the result, so the
// statements the app writes are only ever the ones built here.
//
// Items created earlier in the run are referenced by key ("album",
// "comp:0:3", "track:0:3" — disc index and track number), and
// the server swaps in the new QIDs as it goes.
import { WD_LANG_CODES } from "./languages.ts";
import { parseLength } from "./tracks.ts";
import {
  ALBUM_ID_FIELDS,
  type AlbumIdKey,
  CLASS_KINDS,
  type MusicKind,
  normalizeAlbumId,
} from "./music.ts";

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export interface Settings {
  lang: string;
  langCustom?: boolean;
  date: string;
  p407: string;
  p407Custom?: boolean;
  compDesc: string;
  trackDesc: string;
  trackType: string;
  albumDesc: string;
  compPerformer: boolean;
  straight: boolean;
  extendExisting: boolean;
  /** Add the composers and lyricists a MusicBrainz import found to the compositions. */
  mbWriters: boolean;
  /** Use what MusicBrainz says about each recording, such as being instrumental, for its track. */
  mbDetails: boolean;
  /** The P10135 recording date of tracks with none of their own or from MusicBrainz. */
  recDate: string;
  /** The P1552 recording types, of `REC_TYPES`, of tracks with none of their own. */
  recTypes: string[];
}

export interface AlbumState {
  mode: "existing" | "create";
  qid: string;
  title: string;
  /** A new album's artists, by the names the Performers table maps. */
  artists: string[];
  type: string;
  form: string;
  ids: Record<AlbumIdKey, string>;
  /**
   * The MusicBrainz release the form was loaded from, for an album already on Wikidata
   * as well as a new one. Empty without an import.
   */
  release: string;
  /** Where a MusicBrainz import's album details came from. Null without an import. */
  mb: AlbumMb | null;
}

/** A value a MusicBrainz import filled in, and the MusicBrainz entity it was read from. */
export interface MbCited {
  value: string;
  from: "releaseGroup" | "release";
}

/**
 * The release group and release an import read the album from, for the references on its
 * publication date and identifiers. Each only gets a reference while it's still as imported.
 */
export interface AlbumMb {
  /** P436 MusicBrainz release group ID. */
  releaseGroup: string;
  /** P5813 MusicBrainz release ID. */
  release: string;
  /** The release group's title on MusicBrainz, for the named-as qualifier on P436. */
  releaseGroupName: string;
  /** The day of the import, YYYY-MM-DD. */
  retrieved: string;
  /** The publication date imported. Null when MusicBrainz has none. */
  date: MbCited | null;
  /** The album identifiers imported from MusicBrainz's links, by field. */
  ids: Partial<Record<AlbumIdKey, MbCited>>;
}

/**
 * A composer or lyricist of a track's work on MusicBrainz. Linked to an item by
 * name, in the same table as the performers.
 */
export interface MbWriter {
  /** The MusicBrainz artist ID. */
  id: string;
  name: string;
}

/** A track's identifiers from a MusicBrainz import. */
export interface MbRowIds {
  /**
   * P4404 MusicBrainz recording ID, for the track, new or reused. Empty if an item
   * already has it.
   */
  recording: string;
  /**
   * P435 MusicBrainz work ID, for the composition, new or reused. Empty if an item
   * already has it.
   */
  work: string;
  /**
   * The recording's and the work's names on MusicBrainz, for the named-as
   * qualifier on their IDs. They can differ from the track's title. Empty when unknown.
   */
  recordingName: string;
  workName: string;
  /** P1827 ISWC, for the composition. Empty if an item already has it. */
  iswcs: string[];
  /** P1243 ISRCs, for the track. */
  isrcs: string[];
  /** P2207 Spotify track IDs, for the track. */
  spotify: string[];
  /** P10110 Apple Music track IDs, for the track. */
  appleMusic: string[];
  /** P2724 Deezer track IDs, for the track. */
  deezer: string[];
  /** P4578 Tidal track IDs, for the track. */
  tidal: string[];
  /** The work's P86 composers and P676 lyricists, for the composition. */
  composers: MbWriter[];
  lyricists: MbWriter[];
  /**
   * What the recording's performance relation to its work says about it, of those in
   * `MB_ATTRIBUTES`. Left out when it says none.
   */
  attributes?: MbAttribute[];
  /**
   * The work's languages, as P407 values, of those the form lists. Left out when
   * MusicBrainz has none, or one the form doesn't list.
   */
  languages?: string[];
  /**
   * When the recording was made, from its performance relation to its work, each YYYY,
   * YYYY-MM or YYYY-MM-DD. `end` is empty when MusicBrainz has none. Left out without a
   * `begin`.
   */
  recorded?: { begin: string; end: string };
  /**
   * The recording, work and day the import came from, for the references on the
   * duration, identifiers and writers. Kept even when an item already has the recording
   * or work ID. `work` is left out when the track has no work.
   */
  source: { recording: string; work?: string; retrieved: string } | null;
}

/** A row of a disc's tracklist, as a MusicBrainz import read it or as entered by hand. */
export interface Track {
  n: number;
  title: string;
  /** The names it's credited to, as the Performers table maps them. None means the album's. */
  artists: string[];
  /**
   * Those of `artists` credited as featured ("feat."), as MusicBrainz or the
   * row's artists field gave them. They're performers like the rest, and only
   * shown apart in the track table.
   */
  feat?: string[];
  /** Null when MusicBrainz has no length for it. */
  seconds: number | null;
  /**
   * The length as typed, once it's been edited by hand. It's used in place of
   * `seconds`, and doesn't get the MusicBrainz reference.
   */
  length?: string;
  /** Null for a track from a form saved before tracks had identifiers of their own. */
  mb: MbRowIds | null;
  /** Its P31, one of `TRACK_TYPES`, when it's not the one `trackTypeOf` gives it. */
  type?: string;
  /**
   * Its composition's P407, when it's not the one `trackLangOf` gives it. Empty for none.
   * `p407Custom` is set while it's a QID typed in, which may not be valid yet.
   */
  p407?: string;
  p407Custom?: boolean;
  /** Its P10135 recording date as typed, when it's not the one `trackRecordedOf` gives it. */
  recorded?: string;
  /** Its P1552 recording types, of `REC_TYPES`, when they're not the ones `trackRecTypesOf` gives it. */
  recTypes?: string[];
}

export interface Disc {
  part: string;
  partCustom?: boolean;
  tracks: Track[];
  /** Existing compositions and tracks, by track number. */
  comp: Record<string, string>;
  track: Record<string, string>;
}

/**
 * How the form was started: from a MusicBrainz release, an existing album's
 * QID, a search by name, or a new album. Null while it's being picked.
 */
export type StartingPoint = "mb" | "existing" | "search" | "new";

export interface State {
  start: StartingPoint | null;
  settings: Settings;
  album: AlbumState;
  artists: Record<string, string>;
  discs: Disc[];
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** A link to an item: an existing QID, or one created earlier in the run. */
export type ItemRef = { id: string } | { ref: string };

export type Value =
  | ({ type: "item" } & ItemRef)
  | { type: "string"; value: string }
  | { type: "monolingual"; text: string; language: string }
  | { type: "time"; time: string; precision: 9 | 10 | 11 }
  | { type: "quantity"; amount: number; unit?: string };

export interface Snak {
  property: string;
  value: Value;
}

export interface Claim extends Snak {
  qualifiers?: Snak[];
  /** Each reference is a group of snaks, e.g. stated in, an identifier and retrieved. */
  references?: Snak[][];
  /** Skip it if the item already has any statement for this property, whatever its value. */
  ifMissing?: true;
}

export type Op =
  | {
      op: "create";
      key: string;
      kind: MusicKind | "other";
      labels: Record<string, string>;
      descriptions: Record<string, string>;
      claims: Claim[];
    }
  | {
      op: "addClaims";
      target: ItemRef;
      /** What the target is, for the progress log ("album", "track 1.3"…). */
      what: string;
      /** The row that links to a reused composition or track, by disc index and track number. */
      row?: { kind: "comp" | "track"; di: number; n: number };
      claims: Claim[];
    };

/** What's wrong with a row, by the cell it's fixed in. */
export type RowErrs = Partial<
  Record<"title" | "artists" | "length" | "comp" | "track" | "lang" | "recorded", string>
>;

export type MsgKind = "err" | "warn" | "ok";
export type Msg = [MsgKind, string];

/** The form sections an error can be fixed in, for the run checklist to link to. */
export type BlockerAt = "album" | "settings" | "tracks" | "performers" | "create";

export interface Plan {
  /** Each disc's tracks, with the titles as they're written to Wikidata. */
  tracks: Track[][];
  /** Errors for individual form fields, keyed by field id. */
  fieldErrs: Record<string, string>;
  /** Errors for the cells of a disc's rows, keyed "disc:track". */
  rowErrs: Record<string, RowErrs>;
  messages: Msg[];
  /** Where each error in `messages` is fixed, one per error, in the same order. */
  blockers: BlockerAt[];
  ops: Op[];
  /** True when there is something to do and nothing blocks it. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QID = /^Q\d+$/;
const WD_URL =
  /^(?:https?:\/\/)?(?:www\.|m\.)?wikidata\.org\/(?:wiki\/(?:Special:EntityPage\/)?|entity\/)(Q\d+)\/?(?:[?#].*)?$/i;

export const ALBUM_TYPES = [
  ["Q482994", "album"],
  ["Q169930", "extended play"],
] as const;

export const STUDIO_ALBUM = "Q208569";

export const ALBUM_FORMS = [
  ["Q208569", "studio album"],
  ["Q209939", "live album"],
  ["Q222910", "compilation album"],
  ["Q4176708", "soundtrack album"],
  ["Q963099", "remix album"],
  ["Q1138081", "covers album"],
] as const;

/** The album and EP classes the app knows. Exact QIDs, no subclasses. */
export const ALBUM_CLASSES: ReadonlySet<string> = new Set([
  ...CLASS_KINDS.filter(([, kind]) => kind === "album" || kind === "ep").map(([q]) => q),
  ...ALBUM_FORMS.map(([q]) => q),
]);

export const TRACK_TYPES = [
  ["Q55850593", "music track with vocals"],
  ["Q55850643", "music track without lyrics"],
  ["Q7302866", "audio track"],
] as const;
export const WITH_VOCALS = "Q55850593";
export const WITHOUT_LYRICS = "Q55850643";

/**
 * What kind of recording a track is, as P1552 (has characteristic) values: the ones
 * music tracks on Wikidata use most.
 */
export const REC_TYPES = [
  ["Q15975575", "studio recording"],
  ["Q56123235", "live recording"],
  ["Q155171", "cover version"],
  ["Q25203386", "re-recording"],
  ["Q214272", "remix"],
  ["Q56612794", "instrumental version"],
  ["Q60566516", "acoustic version"],
  ["Q13582719", "medley"],
] as const;
export const STUDIO_RECORDING = "Q15975575";
export const LIVE_RECORDING = "Q56123235";
/** A recording type's name in a sentence, e.g. "live recording". */
export const recTypeName = (qid: string) => REC_TYPES.find(([q]) => q === qid)?.[1] ?? qid;

/** Only the recording types the form lists, each once, in its order. */
export const knownRecTypes = (qids: readonly unknown[]): string[] =>
  REC_TYPES.map(([q]) => q).filter((q) => qids.includes(q));

/** The attributes of a performance relation on MusicBrainz that the form reads. */
export const MB_ATTRIBUTES = ["live", "cover", "instrumental", "medley"] as const;
export type MbAttribute = (typeof MB_ATTRIBUTES)[number];

/**
 * The recording type each MusicBrainz attribute says, for those that say one. Instrumental
 * makes a track without lyrics instead, as an instrumental version is one of a song with words.
 */
const MB_REC_TYPES: Partial<Record<MbAttribute, string>> = {
  live: LIVE_RECORDING,
  cover: "Q155171",
  medley: "Q13582719",
};

/**
 * A track's P1552 recording types: its own, or else the album's with those MusicBrainz's
 * attributes say. A live recording isn't a studio one, so it takes that one's place.
 * `fromMb` lists the ones MusicBrainz gave.
 */
export function trackRecTypesOf(
  S: Settings,
  t: Pick<Track, "mb" | "recTypes">,
): { qids: string[]; fromMb: string[] } {
  const mb = S.mbDetails ? (t.mb?.attributes ?? []).flatMap((a) => MB_REC_TYPES[a] ?? []) : [];
  // A track's own types that MusicBrainz says too are still cited to it.
  if (t.recTypes) {
    const qids = knownRecTypes(t.recTypes);
    return { qids, fromMb: qids.filter((q) => mb.includes(q)) };
  }
  const base = mb.includes(LIVE_RECORDING)
    ? S.recTypes.filter((q) => q !== STUDIO_RECORDING)
    : S.recTypes;
  return { qids: knownRecTypes([...base, ...mb]), fromMb: knownRecTypes(mb) };
}

/**
 * A track's P31: its own, or else without lyrics when MusicBrainz says the recording is
 * instrumental or the work has no linguistic content, or else the album's. `fromMb` says
 * it's the one MusicBrainz gave.
 */
export function trackTypeOf(S: Settings, t: Pick<Track, "type" | "mb">) {
  if (t.type) return { qid: t.type, fromMb: false };
  if (S.mbDetails && (t.mb?.attributes?.includes("instrumental") || wordlessWork(t)))
    return { qid: WITHOUT_LYRICS, fromMb: true };
  return { qid: S.trackType, fromMb: false };
}

/** Whether the work's only language on MusicBrainz is no linguistic content. */
const wordlessWork = (t: Pick<Track, "mb">) => {
  const langs = t.mb?.languages ?? [];
  return langs.length > 0 && langs.every((q) => q.trim() === NO_LINGUISTIC_CONTENT);
};

export const LANGS = [
  ["Q13955", "Arabic"],
  ["Q9186", "Cantonese"],
  ["Q9056", "Czech"],
  ["Q9035", "Danish"],
  ["Q7411", "Dutch"],
  ["Q1860", "English"],
  ["Q150", "French"],
  ["Q188", "German"],
  ["Q9288", "Hebrew"],
  ["Q1568", "Hindi"],
  ["Q652", "Italian"],
  ["Q5287", "Japanese"],
  ["Q9176", "Korean"],
  ["Q397", "Latin"],
  ["Q9192", "Mandarin"],
  ["Q9043", "Norwegian"],
  ["Q809", "Polish"],
  ["Q5146", "Portuguese"],
  ["Q7737", "Russian"],
  ["Q1321", "Spanish"],
  ["Q9027", "Swedish"],
  ["Q34057", "Tagalog"],
  ["Q256", "Turkish"],
] as const;
export const NO_LINGUISTIC_CONTENT = "Q22282939";
const KNOWN_LANGS = new Set<string>([...LANGS.map(([q]) => q), NO_LINGUISTIC_CONTENT]);

/** Where a track's language comes from, when it isn't its own. */
/** "type" is no linguistic content for a track without lyrics, "vocals" none for one with. */
export type LangSource = "album" | "mb" | "type" | "vocals";

/**
 * A track's composition's P407 values: its own, or else the work's on MusicBrainz, or else
 * the album's. A track's type wins over a language that says otherwise: one without lyrics
 * on an album with a language has no linguistic content, and one with vocals doesn't take
 * no linguistic content from MusicBrainz or the album. An instrumental recording on
 * MusicBrainz is a version of a song with words, so its composition keeps the album's
 * language. Values that aren't QIDs are left out.
 */
export function trackLangOf(
  S: Settings,
  t: Pick<Track, "type" | "mb" | "p407">,
): { qids: string[]; from: LangSource | null } {
  const valid = (qs: string[]) => qs.map((q) => q.trim()).filter((q) => QID.test(q));
  if (t.p407 !== undefined) return { qids: valid([t.p407]), from: null };
  const { qid: type, fromMb } = trackTypeOf(S, t);
  const mb = S.mbDetails ? valid(t.mb?.languages ?? []) : [];
  if (mb.length && !(type === WITH_VOCALS && mb.includes(NO_LINGUISTIC_CONTENT)))
    return { qids: mb, from: "mb" };
  const album = valid([S.p407]);
  const wordless = album.includes(NO_LINGUISTIC_CONTENT);
  if (type === WITHOUT_LYRICS && !fromMb && album.length && !wordless)
    return { qids: [NO_LINGUISTIC_CONTENT], from: "type" };
  if (type === WITH_VOCALS && wordless) return { qids: [], from: "vocals" };
  return { qids: album, from: "album" };
}

/**
 * A track's recording date as written: its own, or else the first day MusicBrainz has for
 * the recording, or else the album's. Empty for none.
 */
export function trackRecordedOf(
  S: Settings,
  t: Pick<Track, "mb" | "recorded">,
): { date: string; from: "mb" | "album" | null } {
  if (t.recorded?.trim()) return { date: t.recorded.trim(), from: null };
  if (S.mbDetails && t.mb?.recorded) return { date: t.mb.recorded.begin, from: "mb" };
  return { date: S.recDate.trim(), from: "album" };
}

/** Whether a track's own language is a QID typed in, rather than one the form lists. */
export const isCustomTrackLang = (t: Pick<Track, "p407" | "p407Custom">) =>
  !!t.p407Custom || (!!t.p407?.trim() && !KNOWN_LANGS.has(t.p407.trim()));

export const LABEL_LANGS = [
  ["ar", "Arabic"],
  ["yue", "Cantonese"],
  ["zh", "Chinese"],
  ["zh-hans", "Chinese (Simplified)"],
  ["zh-hant", "Chinese (Traditional)"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["nl", "Dutch"],
  ["en", "English"],
  ["fr", "French"],
  ["de", "German"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["la", "Latin"],
  ["nb", "Norwegian Bokmål"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["pt-br", "Portuguese (Brazil)"],
  ["ru", "Russian"],
  ["es", "Spanish"],
  ["sv", "Swedish"],
  ["tl", "Tagalog"],
  ["tr", "Turkish"],
] as const;
const KNOWN_LABEL_LANGS = new Set<string>(LABEL_LANGS.map(([c]) => c));

export const PARTS = [
  [
    "Compact disc",
    [
      ["Q61629664", "CD1"],
      ["Q61629680", "CD2"],
      ["Q61747994", "CD3"],
      ["Q70931744", "CD4"],
      ["Q99984194", "CD5"],
    ],
  ],
  [
    "Vinyl disc",
    [
      ["Q109658523", "LP1"],
      ["Q109658526", "LP2"],
      ["Q109664010", "LP3"],
    ],
  ],
  [
    "Record or cassette side",
    [
      ["Q3827523", "A-side"],
      ["Q13432985", "B-side"],
      ["Q59554937", "C-side"],
      ["Q59555018", "D-side"],
    ],
  ],
] as const;
const KNOWN_PARTS = new Set<string>(PARTS.flatMap(([, o]) => o.map(([q]) => q)));

export const COMPOSITION_CLASS = "Q105543609";
export const SONG_FORM = "Q7366";
export const TRACK_UNIT = "Q7302866";
export const SECOND_UNIT = "Q11574";
export const MUSICBRAINZ = "Q14005";
export const EP_CLASS = "Q169930";

/** Set a new album's type. An EP isn't a studio album, so switching to EP drops that form. */
export function setAlbumType(s: State, type: string) {
  s.album.type = type;
  if (type === EP_CLASS && s.album.form === STUDIO_ALBUM) s.album.form = "";
}

/** The `{type}` in an album's description: the form's label, or "album" or "EP" when
 * there's no form. An EP says "EP" in place of "album", and a studio EP is just "EP". */
export const descTypeLabel = (type: string, form: string): string => {
  const ep = type === EP_CLASS;
  const label = ALBUM_FORMS.find(([q]) => q === form)?.[1];
  if (!label) return ep ? "EP" : "album";
  if (!ep) return label;
  return form === STUDIO_ALBUM ? "EP" : label.replace(/ album$/, " EP");
};

// ---------------------------------------------------------------------------
// Small helpers (also used by the form)
// ---------------------------------------------------------------------------

/** A pasted Wikidata URL or lowercase q-number → bare QID; anything else unchanged. */
export function normalizeQid(v: string): string {
  const t = v.trim();
  const m = WD_URL.exec(t);
  if (m) return m[1].toUpperCase();
  if (/^q\d+$/i.test(t)) return t.toUpperCase();
  return v;
}

export const isCustomLang = (s: Settings) =>
  !!s.p407Custom || (s.p407.trim() !== "" && !KNOWN_LANGS.has(s.p407.trim()));
export const isCustomLabelLang = (s: Settings) =>
  !!s.langCustom || (s.lang.trim() !== "" && !KNOWN_LABEL_LANGS.has(s.lang.trim()));
export const isCustomPart = (d: Disc) =>
  !!d.partCustom || (d.part.trim() !== "" && !KNOWN_PARTS.has(d.part.trim()));

/** A disc's part as the form shows it: "CD1", or the QID of one the app doesn't know. */
export function partLabel(d: Disc): string {
  const q = d.part.trim();
  for (const [, opts] of PARTS) for (const [p, label] of opts) if (p === q) return label;
  return q;
}

/** A new album's artists, leaving out blank rows. */
export const albumArtists = (state: State) =>
  state.album.artists.map((a) => a.trim()).filter(Boolean);

type ParsedDate =
  | { ok: true; val: null; year: "" }
  | { ok: true; val: { time: string; precision: 9 | 10 | 11 }; year: string }
  | { ok: false; error: string };

export function parseDate(raw: string): ParsedDate {
  const s = raw.trim();
  if (!s) return { ok: true, val: null, year: "" };
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s);
  if (!m) return { ok: false, error: "Use YYYY, YYYY-MM or YYYY-MM-DD." };
  const [, y, mo, da] = m;
  if (mo !== undefined && (+mo < 1 || +mo > 12))
    return { ok: false, error: `${mo} isn't a month (01–12).` };
  if (da !== undefined) {
    const dim = new Date(Date.UTC(+y, +mo, 0)).getUTCDate();
    if (+da < 1 || +da > dim)
      return { ok: false, error: `${y}-${mo} has ${dim} days, so day ${da} doesn't exist.` };
    return { ok: true, val: { time: `+${s}T00:00:00Z`, precision: 11 }, year: y };
  }
  if (mo !== undefined)
    return { ok: true, val: { time: `+${y}-${mo}-00T00:00:00Z`, precision: 10 }, year: y };
  return { ok: true, val: { time: `+${y}-00-00T00:00:00Z`, precision: 9 }, year: y };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH = String.raw`([a-z]{3,9})\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const MDY = new RegExp(String.raw`^${MONTH}\s+${DAY},?\s+(\d{4})$`, "i");
const DMY = new RegExp(String.raw`^${DAY}\s+(?:of\s+)?${MONTH},?\s+(\d{4})$`, "i");
const MY = new RegExp(String.raw`^${MONTH},?\s+(\d{4})$`, "i");

/** 1-based month number for an English month name or abbreviation ("Jun", "Sept"), or 0. */
function monthNum(name: string): number {
  const n = name.toLowerCase();
  if (n.length < 3) return 0;
  return MONTHS.findIndex((full) => full.startsWith(n)) + 1;
}

/**
 * Rewrites a written-out English date such as "June 12, 2012", "12 June 2012" or "June 2012" as
 * YYYY-MM-DD or YYYY-MM. Anything else comes back unchanged, so parseDate can report it.
 */
export function normalizeDate(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  const pad = (n: string) => n.padStart(2, "0");
  let m = MDY.exec(s);
  if (m && monthNum(m[1])) return `${m[3]}-${pad(String(monthNum(m[1])))}-${pad(m[2])}`;
  m = DMY.exec(s);
  if (m && monthNum(m[2])) return `${m[3]}-${pad(String(monthNum(m[2])))}-${pad(m[1])}`;
  m = MY.exec(s);
  if (m && monthNum(m[1])) return `${m[2]}-${pad(String(monthNum(m[1])))}`;
  return raw;
}

const EMPTY_TEMPLATE = "Empty, so no description will be added.";

function checkTemplate(tpl: string, date: ParsedDate, vars = ["year", "artists"]): string[] {
  const errs: string[] = [];
  const used = [...tpl.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = [...new Set(used.filter((v) => !vars.includes(v)))];
  if (unknown.length)
    errs.push(
      `Unknown variable${unknown.length > 1 ? "s" : ""} ${unknown.map((v) => `{${v}}`).join(", ")}. Available: ${vars.map((v) => `{${v}}`).join(", ")}.`,
    );
  if (/[{}]/.test(tpl.replace(/\{[^{}]*\}/g, ""))) errs.push("Unmatched { or }.");
  if (used.includes("year")) {
    if (!date.ok) errs.push("{year} needs a valid publication date.");
    else if (!date.val) errs.push("{year} is used but publication date is empty.");
  }
  if (!tpl.trim()) errs.push(EMPTY_TEMPLATE);
  return errs;
}
const blocking = (err: string) => !!err && err !== EMPTY_TEMPLATE;

/** Names joined as a list in a sentence: "a, b and c". */
export const joinNames = (a: string[]) =>
  a.length < 2 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

function fillDesc(tpl: string, year: string, artists: string[], type = ""): string {
  // Replaced by functions, so a `$` in a name isn't read as a replacement pattern.
  return tpl
    .replace(/\{year\}/g, () => year)
    .replace(/\{artists\}/g, () => joinNames(artists))
    .replace(/\{type\}/g, () => type)
    .replace(/\s+/g, " ")
    .replace(/\s+([;,])/g, "$1")
    .replace(/[;,]\s*$/, "")
    .trim();
}

export interface DescPreviews {
  comp: string;
  track: string;
}

/**
 * The description templates filled in for the first track with artists, so the
 * settings can show what they write. A {year} the form can't fill yet stays as
 * written. Null until a track has artists.
 */
export function descPreviews(state: State, plan: Plan): DescPreviews | null {
  const S = state.settings;
  const rows = plan.tracks.flatMap((ts, di) => ts.map((t) => ({ t, d: state.discs[di] })));
  const first = rows.find(({ t }) => t.artists.length);
  const artists = first?.t.artists ?? albumArtists(state);
  if (!artists.length) return null;
  const date = parseDate(S.date);
  const year = (date.ok && date.year) || "{year}";
  return {
    comp: fillDesc(S.compDesc, year, artists),
    track: fillDesc(S.trackDesc, year, artists),
  };
}

/**
 * A new album's description template filled in, as `descPreviews` does for the
 * other items. A {year} or {artists} the form can't fill yet stays as written.
 */
export function albumDescPreview(state: State): string {
  const A = state.album;
  const date = parseDate(state.settings.date);
  const year = (date.ok && date.year) || "{year}";
  const artists = albumArtists(state);
  return fillDesc(
    state.settings.albumDesc,
    year,
    artists.length ? artists : ["{artists}"],
    descTypeLabel(A.type, A.form),
  );
}

const item = (id: string): Value => ({ type: "item", id });
const ref = (key: string): Value => ({ type: "item", ref: key });
const claim = (property: string, value: Value, qualifiers?: Snak[]): Claim =>
  qualifiers?.length ? { property, value, qualifiers } : { property, value };

/**
 * A MusicBrainz ID, named as (P1810) the entity is on MusicBrainz. The name is
 * kept exactly as MusicBrainz has it, typographic quotes included.
 */
const mbId = (property: string, id: string, name: string): Claim =>
  claim(
    property,
    { type: "string", value: id },
    name ? [{ property: "P1810", value: { type: "string", value: name } }] : [],
  );

/** Stated in MusicBrainz, with the MusicBrainz ID it was read from and the day of the import. */
const statedInMb = (
  property: string,
  id: string,
  retrieved: string,
): Pick<Claim, "references"> => ({
  references: [
    [
      { property: "P248", value: item(MUSICBRAINZ) },
      { property, value: { type: "string", value: id } },
      { property: "P813", value: { type: "time", time: `+${retrieved}T00:00:00Z`, precision: 11 } },
    ],
  ],
});

/**
 * Whether `releaseGroup` has already been loaded into the form by the
 * MusicBrainz import. The import leaves the release group in the album's IDs,
 * but so does typing it into the new album's ID field, so it must also have
 * filled in some track's identifiers.
 */
export function loadedReleaseGroup(state: State, releaseGroup: string) {
  return (
    normalizeAlbumId("musicbrainz", state.album.ids.musicbrainz) === releaseGroup &&
    state.discs.some((d) => d.tracks.some((t) => t.mb))
  );
}

/**
 * Whether a new album's detail gets a MusicBrainz reference: the detail is still
 * the value the import filled in, and the album still has the imported release
 * group.
 */
export function citesMb(state: State, cited: MbCited | null | undefined, value: string) {
  const A = state.album;
  return (
    A.mode === "create" &&
    !!A.mb &&
    !!cited &&
    cited.value === value &&
    normalizeAlbumId("musicbrainz", A.ids.musicbrainz) === A.mb.releaseGroup
  );
}

/** Whether the new album's publication date gets a MusicBrainz reference. */
export function citesMbDate(state: State) {
  const date = parseDate(state.settings.date);
  return date.ok && !!date.val && citesMb(state, state.album.mb?.date, state.settings.date.trim());
}

/** A MusicBrainz reference for a new album's detail, when `citesMb` allows one. */
function albumMbRef(state: State, cited: MbCited | null | undefined, value: string) {
  const mb = state.album.mb;
  if (!mb || !cited || !citesMb(state, cited, value)) return {};
  return cited.from === "releaseGroup"
    ? statedInMb("P436", mb.releaseGroup, mb.retrieved)
    : statedInMb("P5813", mb.release, mb.retrieved);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface PlanItem {
  r: Track;
  di: number;
  part: string | null;
  perf: string[];
  existComp: string | null;
  existTrack: string | null;
  /** The QIDs of the composers and lyricists its composition gets. */
  writers: { composers: string[]; lyricists: string[] };
}

/** Wikidata's limit on a label or description. */
export const MAX_TERM_LENGTH = 250;
/** Length as Wikidata counts it, in code points rather than UTF-16 units. */
const chars = (s: string) => s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

/** More tracks than this on one disc is likely a mistake. */
export const MAX_TRACKS_PER_DISC = 50;
/** Tracks per run, across all discs; a bigger release goes in several runs. */
export const MAX_TRACKS = 100;
/** A backstop on edits per run. At most ~2 per track (composition and track), so
 * MAX_TRACKS keeps runs well under it. */
export const MAX_OPS = 500;

export function buildPlan(state: State): Plan {
  const S = state.settings;
  const lang = S.lang.trim();
  const fieldErrs: Record<string, string> = {};
  const rowErrs: Record<string, RowErrs> = {};
  const messages: Msg[] = [];
  const blockers: BlockerAt[] = [];
  const err = (text: string, at: BlockerAt) => {
    messages.push(["err", text]);
    blockers.push(at);
  };

  fieldErrs.lang = !lang
    ? isCustomLabelLang(S)
      ? "Enter a language code, e.g. pt-br."
      : "Choose a label language."
    : !WD_LANG_CODES.has(lang)
      ? `"${lang}" isn't a language code Wikidata accepts for both labels and titles.`
      : "";
  const date = parseDate(S.date);
  fieldErrs.date = date.ok ? "" : date.error;
  const p407 = S.p407.trim();
  const p407ok = QID.test(p407);
  fieldErrs.p407 = isCustomLang(S)
    ? !p407
      ? "Enter a QID, or choose None."
      : !p407ok
        ? `"${p407}" isn't a QID (e.g. Q1860).`
        : ""
    : "";
  const recDate = parseDate(S.recDate);
  fieldErrs.recDate = recDate.ok ? "" : recDate.error;
  fieldErrs.compDesc = checkTemplate(S.compDesc, date).join(" ");
  fieldErrs.trackDesc = checkTemplate(S.trackDesc, date).join(" ");

  const straighten = (s: string) =>
    S.straight ? s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"') : s;
  // A row with no artists of its own is the new album's.
  const fallbackArtists = state.album.mode === "create" ? albumArtists(state) : [];
  const typedSeconds = (length: string) => {
    const parsed = parseLength(length);
    return parsed.ok ? parsed.seconds : null;
  };
  const tracks = state.discs.map((d) =>
    d.tracks.map((t): Track => ({
      ...t,
      title: straighten(t.title.trim()),
      artists: t.artists.length ? t.artists : fallbackArtists,
      seconds: t.length === undefined ? t.seconds : typedSeconds(t.length),
    })),
  );
  const unmapped = new Set<string>();
  const badPerf = new Set<string>();
  const invalid: string[] = [];
  const perfFor = (names: string[]) => {
    const perf = names.map((a) => (state.artists[a] ?? "").trim());
    names.forEach((a, i) => {
      if (!perf[i]) unmapped.add(a);
      else if (!QID.test(perf[i])) badPerf.add(a);
    });
    return perf.filter((x) => QID.test(x));
  };
  // Composers and lyricists are optional, so one with no QID is left off. One that isn't
  // a QID is still an error, as a performer's is.
  const badWriter = new Set<string>();
  const writersFor = (ws: MbWriter[]) => {
    const qids = new Set<string>();
    for (const w of ws) {
      const q = (state.artists[w.name] ?? "").trim();
      if (QID.test(q)) qids.add(q);
      else if (q) badWriter.add(w.name);
    }
    return [...qids];
  };

  /* album */
  const A = state.album;
  const creatingAlbum = A.mode === "create";
  const albumNames = creatingAlbum ? albumArtists(state) : [];
  const albumPerf = perfFor(albumNames);
  const albumTitle = creatingAlbum ? straighten(A.title.trim()) : "";
  const albumTypeLabel = descTypeLabel(A.type, A.form);
  Object.assign(fieldErrs, { albumQid: "", albumTitle: "", albumArtists: "", albumDesc: "" });
  const albumIds: Claim[] = [];
  if (!creatingAlbum) {
    const aq = A.qid.trim();
    if (!aq) fieldErrs.albumQid = "Enter the album's QID, or choose to create it.";
    else if (!QID.test(aq)) fieldErrs.albumQid = `"${aq}" isn't a QID.`;
  } else {
    if (!albumTitle) fieldErrs.albumTitle = "Enter the album title.";
    else if (chars(albumTitle) > MAX_TERM_LENGTH)
      fieldErrs.albumTitle = `Wikidata allows ${MAX_TERM_LENGTH} characters at most. This title has ${chars(albumTitle)}.`;
    if (!albumNames.length) fieldErrs.albumArtists = "Enter at least one album artist.";
    fieldErrs.albumDesc = checkTemplate(S.albumDesc, date, ["year", "type", "artists"]).join(" ");
    for (const f of ALBUM_ID_FIELDS) {
      const v = (A.ids[f.key] ?? "").trim();
      fieldErrs[`albumId-${f.key}`] = "";
      if (!v) continue;
      if (!f.pattern.test(v))
        fieldErrs[`albumId-${f.key}`] = `That doesn't look like a ${f.label}.`;
      else if (f.key === "musicbrainz")
        // Named as the release group the import read, while it's still that one.
        albumIds.push(mbId(f.property, v, v === A.mb?.releaseGroup ? A.mb.releaseGroupName : ""));
      else
        albumIds.push({
          ...claim(f.property, { type: "string", value: v }),
          ...albumMbRef(state, A.mb?.ids[f.key], v),
        });
    }
  }
  const albumErr =
    !!(fieldErrs.albumQid || fieldErrs.albumTitle || fieldErrs.albumArtists) ||
    blocking(fieldErrs.albumDesc) ||
    ALBUM_ID_FIELDS.some((f) => !!fieldErrs[`albumId-${f.key}`]);
  const album: ItemRef = creatingAlbum ? { ref: "album" } : { id: A.qid.trim() };

  /* rows */
  const items: PlanItem[] = [];
  tracks.forEach((rows, di) => {
    const d = state.discs[di];
    const part = d.part.trim();
    if (part && !QID.test(part)) invalid.push(`Disc ${di + 1} part "${part}"`);
    for (const r of rows) {
      const perf = perfFor(r.artists);
      const ec = (d.comp[r.n] ?? "").trim();
      const et = (d.track[r.n] ?? "").trim();
      const errs: RowErrs = {};
      if (!r.title) errs.title = "Enter the title.";
      else if (chars(r.title) > MAX_TERM_LENGTH)
        errs.title = `Wikidata allows ${MAX_TERM_LENGTH} characters at most. This title has ${chars(r.title)}.`;
      if (!r.artists.length) errs.artists = "Enter the artists.";
      if (r.length !== undefined && !parseLength(r.length).ok) errs.length = "Use m:ss";
      if (ec && !QID.test(ec)) errs.comp = `"${ec}" isn't a QID.`;
      if (et && !QID.test(et)) errs.track = `"${et}" isn't a QID.`;
      // An existing composition keeps its language, so what's typed for it doesn't matter.
      const ownLang = r.p407?.trim() ?? "";
      // So does an existing track, unless Link reused items adds the date to it.
      const ownRecorded = parseDate(r.recorded ?? "");
      if (!ownRecorded.ok && !(QID.test(et) && !S.extendExisting))
        errs.recorded = ownRecorded.error;
      if (isCustomTrackLang(r) && !QID.test(ec)) {
        if (!ownLang) errs.lang = "Enter a QID, or choose another language.";
        else if (!QID.test(ownLang)) errs.lang = `"${ownLang}" isn't a QID (e.g. Q1860).`;
      }
      if (Object.keys(errs).length) rowErrs[`${di}:${r.n}`] = errs;
      // A reused composition only gets them with Link reused items on.
      const getsWriters = S.mbWriters && !!r.mb && (!ec || S.extendExisting);
      items.push({
        r,
        di,
        part: QID.test(part) ? part : null,
        perf,
        existComp: QID.test(ec) ? ec : null,
        existTrack: QID.test(et) ? et : null,
        writers: {
          composers: getsWriters ? writersFor(r.mb!.composers) : [],
          lyricists: getsWriters ? writersFor(r.mb!.lyricists) : [],
        },
      });
    }
  });

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const it of items) {
    const k = `${it.di}:${it.r.n}`;
    if (seen.has(k)) dupes.add(`disc ${it.di + 1} track ${it.r.n}`);
    seen.add(k);
  }

  // Tracks of one MusicBrainz work or recording would each give their own item the same P435
  // or P4404. A reused item gets it too with Link reused items on, so it counts, but tracks
  // reusing the same item give it to that one item.
  const sharedIds = (
    idOf: (it: PlanItem) => string | undefined,
    exist: (it: PlanItem) => string | null,
  ) => {
    const byId = new Map<string, { at: string[]; items: Set<string> }>();
    for (const it of items) {
      const id = idOf(it);
      const reused = exist(it);
      if (!id || (reused && !S.extendExisting)) continue;
      const shared = byId.get(id) ?? { at: [], items: new Set() };
      shared.at.push(`${it.di + 1}.${it.r.n}`);
      shared.items.add(reused ?? `${it.di}:${it.r.n}`);
      byId.set(id, shared);
    }
    return [...byId.values()].filter((s) => s.items.size > 1).map((s) => s.at);
  };
  const sharedWorks = sharedIds(
    (it) => it.r.mb?.work,
    (it) => it.existComp,
  );
  const sharedRecordings = sharedIds(
    (it) => it.r.mb?.recording,
    (it) => it.existTrack,
  );

  // With several discs, the tracklist tells them apart only by their parts: each needs its own.
  const listed = state.discs.flatMap((d, di) => (tracks[di].length ? [{ d, di }] : []));
  const noPart: number[] = [];
  const byPart = new Map<string, number[]>();
  if (listed.length > 1)
    for (const { d, di } of listed) {
      const part = d.part.trim();
      fieldErrs[`part-${di}`] = "";
      if (!part) {
        noPart.push(di + 1);
        fieldErrs[`part-${di}`] =
          "Choose this disc's part. Each disc needs one when there are several.";
      } else if (QID.test(part)) byPart.set(part, [...(byPart.get(part) ?? []), di]);
    }
  const sharedParts = [...byPart.values()].filter((at) => at.length > 1);
  for (const at of sharedParts)
    for (const di of at)
      fieldErrs[`part-${di}`] =
        `Disc ${at.find((o) => o !== di)! + 1} has this part too. Each disc needs its own.`;

  if (!items.length) err("Add the album's tracks, or load them from MusicBrainz.", "tracks");
  tracks.forEach((rows, di) => {
    if (rows.length > MAX_TRACKS_PER_DISC)
      err(
        `Disc ${di + 1} has ${rows.length} tracks, but a disc can have at most ${MAX_TRACKS_PER_DISC}. ` +
          "Split it into more discs, or into separate runs.",
        "tracks",
      );
  });
  const trackCount = tracks.reduce((n, rows) => n + rows.length, 0);
  if (trackCount > MAX_TRACKS)
    err(
      `That's ${trackCount} tracks across all discs, but a run can have at most ${MAX_TRACKS}. ` +
        "Split the release into separate runs.",
      "tracks",
    );
  if (albumErr) err("Fix the album details at the top of the page.", "album");
  if (dupes.size) err(`Track numbers repeat within a disc: ${[...dupes].join(", ")}.`, "tracks");
  for (const at of sharedWorks)
    err(
      `Tracks ${at.slice(0, -1).join(", ")} and ${at.at(-1)} are performances of the same MusicBrainz work. ` +
        "Discographer can't create this album for now.",
      "tracks",
    );
  for (const at of sharedRecordings)
    err(
      `Tracks ${at.slice(0, -1).join(", ")} and ${at.at(-1)} are the same MusicBrainz recording. ` +
        "Discographer can't create this album for now.",
      "tracks",
    );
  const discList = (ns: number[]) =>
    ns.length === 1 ? `Disc ${ns[0]}` : `Discs ${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`;
  if (noPart.length)
    err(
      `${discList(noPart)} ${noPart.length === 1 ? "has" : "have"} no part. ` +
        "A release with several discs needs a part on each, e.g. CD1 and CD2, " +
        "so their track numbers can be told apart.",
      "tracks",
    );
  for (const at of sharedParts)
    err(
      `${discList(at.map((di) => di + 1))} have the same part, ${partLabel(state.discs[at[0]])}. ` +
        "Give each disc its own part.",
      "tracks",
    );
  if (badPerf.size) err(`Performer QID isn't valid for: ${[...badPerf].join(", ")}.`, "performers");
  for (const name of badPerf) badWriter.delete(name);
  if (badWriter.size)
    err(`Composer or lyricist QID isn't valid for: ${[...badWriter].join(", ")}.`, "performers");
  if (unmapped.size) err(`No performer QID for: ${[...unmapped].join(", ")}.`, "performers");
  if (invalid.length) err(`Not a QID: ${invalid.join(", ")}.`, "tracks");
  const settingsErr =
    !!fieldErrs.lang ||
    !!fieldErrs.date ||
    !!fieldErrs.p407 ||
    !!fieldErrs.recDate ||
    blocking(fieldErrs.compDesc) ||
    blocking(fieldErrs.trackDesc);
  if (settingsErr) err("Fix the errors in Item settings.", "settings");
  const badRows = Object.keys(rowErrs).length;
  if (badRows)
    err(
      `${badRows} track${badRows === 1 ? " has" : "s have"} errors. They're marked in the track table.`,
      "tracks",
    );

  const blocked = messages.some((m) => m[0] === "err");
  if (blocked) return { tracks, fieldErrs, rowErrs, messages, blockers, ops: [], ready: false };

  /* operations */
  const ops: Op[] = [];
  const year = date.ok ? date.year : "";
  const pubDate =
    date.ok && date.val
      ? [
          {
            ...claim("P577", { type: "time", ...date.val }),
            ...albumMbRef(state, A.mb?.date, S.date.trim()),
          },
        ]
      : [];
  const workLang = p407ok ? [claim("P407", item(p407))] : [];
  const title = (t: string) => claim("P1476", { type: "monolingual", text: t, language: lang });
  // A title is a name that reads the same in any language, so it also goes under `mul` and
  // shows in every language without a label for each. `mul` takes no descriptions.
  const labelled = (t: string, desc: string) => ({
    labels: lang !== "mul" ? { [lang]: t, mul: t } : { [lang]: t },
    descriptions: desc && lang !== "mul" ? { [lang]: desc } : {},
  });
  const str = (property: string, value: string) => claim(property, { type: "string", value });
  // Stated in MusicBrainz, with the recording and the day of the import.
  const mbRef = (mb: MbRowIds | null): Pick<Claim, "references"> =>
    mb?.source ? statedInMb("P4404", mb.source.recording, mb.source.retrieved) : {};
  // The recording ID itself goes unreferenced: citing MusicBrainz for its own ID adds nothing.
  const trackIds = (mb: MbRowIds | null) => {
    if (!mb) return [];
    const cited = (property: string, value: string) => ({ ...str(property, value), ...mbRef(mb) });
    return [
      ...(mb.recording ? [mbId("P4404", mb.recording, mb.recordingName)] : []),
      ...mb.isrcs.map((v) => cited("P1243", v)),
      ...mb.spotify.map((v) => cited("P2207", v)),
      ...mb.appleMusic.map((v) => cited("P10110", v)),
      ...mb.deezer.map((v) => cited("P2724", v)),
      ...mb.tidal.map((v) => cited("P4578", v)),
    ];
  };
  // P10135, cited to the recording when it's the date MusicBrainz has.
  const recordedClaims = (it: PlanItem): Claim[] => {
    const { date: d, from } = trackRecordedOf(S, it.r);
    const parsed = parseDate(d);
    if (!parsed.ok || !parsed.val) return [];
    return [
      {
        ...claim("P10135", { type: "time", ...parsed.val }),
        ...(from === "mb" ? mbRef(it.r.mb) : {}),
      },
    ];
  };
  // P1552, cited to the recording when MusicBrainz says it.
  const recTypeClaims = (it: PlanItem): Claim[] => {
    const { qids, fromMb } = trackRecTypesOf(S, it.r);
    return qids.map((q) => ({
      ...claim("P1552", item(q)),
      ...(fromMb.includes(q) ? mbRef(it.r.mb) : {}),
    }));
  };
  // A language from MusicBrainz is cited to the work, as the writers are.
  const langClaims = (it: PlanItem): Claim[] => {
    const { qids, from } = trackLangOf(S, it.r);
    const src = it.r.mb?.source;
    const cite = from === "mb" && src?.work ? statedInMb("P435", src.work, src.retrieved) : {};
    return qids.map((q) => ({ ...claim("P407", item(q)), ...cite }));
  };
  // Cited to the work, which is what MusicBrainz states them on.
  const writerClaims = (it: PlanItem): Claim[] => {
    const src = it.r.mb?.source;
    const cite = src?.work ? statedInMb("P435", src.work, src.retrieved) : {};
    return [
      ...it.writers.composers.map((q) => ({ ...claim("P86", item(q)), ...cite })),
      ...it.writers.lyricists.map((q) => ({ ...claim("P676", item(q)), ...cite })),
    ];
  };
  const compKey = (it: PlanItem) => `comp:${it.di}:${it.r.n}`;
  const trackKey = (it: PlanItem) => `track:${it.di}:${it.r.n}`;
  const where = (it: PlanItem) => `track ${it.di + 1}.${it.r.n} “${it.r.title}”`;
  const rowOf = (kind: "comp" | "track", it: PlanItem) => ({
    kind,
    di: it.di,
    n: it.r.n,
  });

  // Number of tracks: one statement per disc when every disc names its part, else one in all.
  const perDisc = state.discs
    .map((d, di) => ({ n: items.filter((it) => it.di === di).length, part: d.part.trim() }))
    .filter((x) => x.n);
  const counts =
    perDisc.length > 1 && perDisc.every((x) => QID.test(x.part))
      ? perDisc.map((x) =>
          claim("P2635", { type: "quantity", amount: x.n, unit: TRACK_UNIT }, [
            { property: "P518", value: item(x.part) },
          ]),
        )
      : [claim("P2635", { type: "quantity", amount: items.length, unit: TRACK_UNIT })];

  // 1. The album, without its tracklist (the tracks don't exist yet).
  if (creatingAlbum) {
    ops.push({
      op: "create",
      key: "album",
      kind: A.type === EP_CLASS ? "ep" : "album",
      ...labelled(albumTitle, fillDesc(S.albumDesc, year, albumNames, albumTypeLabel)),
      claims: [
        claim("P31", item(A.type)),
        ...(A.form ? [claim("P7937", item(A.form))] : []),
        title(albumTitle),
        ...albumPerf.map((p) => claim("P175", item(p))),
        ...pubDate,
        ...workLang,
        ...counts,
        ...albumIds,
      ],
    });
  }

  // 2. Compositions.
  for (const it of items) {
    const perf = S.compPerformer ? it.perf.map((p) => claim("P175", item(p))) : [];
    const work = it.r.mb?.work ? [mbId("P435", it.r.mb.work, it.r.mb.workName)] : [];
    if (it.existComp) {
      // Not a second work ID: a composition with another may be a different work, or one
      // MusicBrainz merged, and a second would hide that.
      const extend = [
        ...perf,
        ...writerClaims(it),
        ...work.map((c): Claim => ({ ...c, ifMissing: true })),
      ];
      if (S.extendExisting && extend.length)
        ops.push({
          op: "addClaims",
          target: { id: it.existComp },
          what: `composition for ${where(it)}`,
          row: rowOf("comp", it),
          claims: extend,
        });
      continue;
    }
    ops.push({
      op: "create",
      key: compKey(it),
      kind: "work",
      ...labelled(it.r.title, fillDesc(S.compDesc, year, it.r.artists)),
      claims: [
        claim("P31", item(COMPOSITION_CLASS)),
        claim("P7937", item(SONG_FORM)),
        title(it.r.title),
        ...perf,
        ...writerClaims(it),
        ...langClaims(it),
        ...work,
        ...(it.r.mb?.iswcs.map((v) => ({ ...str("P1827", v), ...mbRef(it.r.mb) })) ?? []),
      ],
    });
  }

  // 3. Tracks, each linked to its composition.
  const compOf = (it: PlanItem): Value => (it.existComp ? item(it.existComp) : ref(compKey(it)));
  for (const it of items) {
    const perf = it.perf.map((p) => claim("P175", item(p)));
    if (it.existTrack) {
      if (S.extendExisting)
        ops.push({
          op: "addClaims",
          target: { id: it.existTrack },
          what: where(it),
          row: rowOf("track", it),
          claims: [
            claim("P2550", compOf(it)),
            ...perf,
            ...recordedClaims(it).map((c): Claim => ({ ...c, ifMissing: true })),
            ...recTypeClaims(it).map((c): Claim => ({ ...c, ifMissing: true })),
            // Not a second recording ID, as with a composition's work ID.
            ...(it.r.mb?.recording
              ? [
                  {
                    ...mbId("P4404", it.r.mb.recording, it.r.mb.recordingName),
                    ifMissing: true as const,
                  },
                ]
              : []),
          ],
        });
      continue;
    }
    const type = trackTypeOf(S, it.r);
    ops.push({
      op: "create",
      key: trackKey(it),
      kind: "track",
      ...labelled(it.r.title, fillDesc(S.trackDesc, year, it.r.artists)),
      claims: [
        { ...claim("P31", item(type.qid)), ...(type.fromMb ? mbRef(it.r.mb) : {}) },
        title(it.r.title),
        ...perf,
        claim("P2550", compOf(it)),
        ...(it.r.seconds !== null
          ? [
              {
                ...claim("P2047", { type: "quantity", amount: it.r.seconds, unit: SECOND_UNIT }),
                // A length typed by hand isn't the one MusicBrainz states.
                ...(it.r.length === undefined ? mbRef(it.r.mb) : {}),
              },
            ]
          : []),
        ...recordedClaims(it),
        ...recTypeClaims(it),
        ...trackIds(it.r.mb),
      ],
    });
  }

  // 4. The album's tracklist, in one edit. An existing album also gets its number of tracks,
  // which a tracklist needs, unless it already says how many it has.
  const trackOf = (it: PlanItem): Value =>
    it.existTrack ? item(it.existTrack) : ref(trackKey(it));
  ops.push({
    op: "addClaims",
    target: album,
    what: "album tracklist",
    claims: [
      ...items.map((it) =>
        claim("P658", trackOf(it), [
          { property: "P1545", value: { type: "string", value: String(it.r.n) } },
          ...(it.part ? [{ property: "P518", value: item(it.part) }] : []),
        ]),
      ),
      ...(creatingAlbum ? [] : counts.map((c): Claim => ({ ...c, ifMissing: true }))),
    ],
  });

  // Wikidata rejects an over-long label or description, which would stop the run partway.
  const tooLong = new Set<string>();
  for (const o of ops) {
    if (o.op !== "create") continue;
    const [kind, di, n] = o.key.split(":");
    const row = n ? `track ${Number(di) + 1}.${n}` : "";
    for (const t of Object.values(o.labels))
      if (chars(t) > MAX_TERM_LENGTH) tooLong.add(`the title of ${row} (${chars(t)})`);
    for (const t of Object.values(o.descriptions))
      if (chars(t) > MAX_TERM_LENGTH)
        tooLong.add(
          row
            ? `the ${kind === "comp" ? "composition" : kind} description for ${row} (${chars(t)})`
            : `the album description (${chars(t)})`,
        );
  }
  if (tooLong.size) {
    err(
      `Wikidata allows ${MAX_TERM_LENGTH} characters at most in a label or description. ` +
        `Too long: ${[...tooLong].join(", ")}.`,
      "create",
    );
    return { tracks, fieldErrs, rowErrs, messages, blockers, ops: [], ready: false };
  }

  if (ops.length > MAX_OPS) {
    err(
      `That's ${ops.length} edits, but a run can make at most ${MAX_OPS}. Split it into smaller runs.`,
      "create",
    );
    return { tracks, fieldErrs, rowErrs, messages, blockers, ops: [], ready: false };
  }

  const creates = (prefix: string) =>
    ops.filter((o) => o.op === "create" && o.key.startsWith(prefix)).length;
  messages.push([
    "ok",
    [
      creatingAlbum ? "Creates the album" : `Adds to ${A.qid.trim()}`,
      `${creates("comp:")} composition(s) to create, ${items.length - creates("comp:")} reused`,
      `${creates("track:")} track(s) to create, ${items.length - creates("track:")} reused`,
      `${items.length} tracklist statement(s)`,
    ].join(". ") + ".",
  ]);
  return { tracks, fieldErrs, rowErrs, messages, blockers, ops, ready: ops.length > 0 };
}

// ---------------------------------------------------------------------------
// Describing operations
// ---------------------------------------------------------------------------

export const KIND_NAMES: Record<string, string> = {
  album: "album",
  ep: "EP",
  single: "single",
  work: "composition",
  track: "track",
};

/**
 * What an operation does, in a few words: the run log's line for it and the
 * preview's heading. A create's is what it makes, e.g. `track “Versailles”`.
 * `sent` is how many of an addClaims' statements are actually added, for an
 * edit summary when the item already has some of them.
 */
export function describeOp(op: Op, sent?: number): string {
  if (op.op === "addClaims") {
    const n = sent ?? op.claims.length;
    return `Add ${n} statement${n === 1 ? "" : "s"} to ${op.what}`;
  }
  const label = Object.values(op.labels)[0] ?? "";
  return `${KIND_NAMES[op.kind] ?? "item"} “${label}”`;
}
