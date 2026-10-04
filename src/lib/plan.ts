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
// "comp:0:3", "track:0:3", "single:0:3" — disc index and track number), and
// the server swaps in the new QIDs as it goes.
import { WD_LANG_CODES } from "./languages.ts";
import { ALBUM_ID_FIELDS, type AlbumIdKey, type MusicKind } from "./music.ts";

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
  singleDesc: string;
  albumDesc: string;
  compPerformer: boolean;
  duration: boolean;
  publishedIn: boolean;
  straight: boolean;
  splitArtists: boolean;
  extendExisting: boolean;
}

export interface AlbumState {
  mode: "existing" | "create";
  qid: string;
  title: string;
  artists: string;
  type: string;
  form: string;
  ids: Record<AlbumIdKey, string>;
}

export interface SingleState {
  date: string;
  qid: string;
}

export interface Disc {
  part: string;
  partCustom?: boolean;
  text: string;
  comp: Record<string, string>;
  track: Record<string, string>;
  single: Record<string, SingleState>;
}

export interface State {
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
      claims: Claim[];
    };

export type MsgKind = "err" | "warn" | "ok";
export type Msg = [MsgKind, string];

export interface ParsedRow {
  n: number;
  title: string;
  artists: string[];
  seconds: number;
  raw: string;
  error?: undefined;
}
export type Row = ParsedRow | { error: string; raw: string };

export interface Plan {
  parsed: Row[][];
  /** Errors for individual form fields, keyed by field id. */
  fieldErrs: Record<string, string>;
  /** Errors for single rows, keyed "disc:track". */
  singleErrs: Record<string, string>;
  messages: Msg[];
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

export const ALBUM_FORMS = [
  ["Q208569", "studio album"],
  ["Q209939", "live album"],
  ["Q222910", "compilation album"],
  ["Q4176708", "soundtrack album"],
  ["Q963099", "remix album"],
  ["Q1138081", "covers album"],
] as const;

export const TRACK_TYPES = [
  ["Q55850593", "music track with vocals"],
  ["Q55850643", "music track without lyrics"],
  ["Q7302866", "audio track"],
] as const;

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

export const SINGLE_CLASS = "Q134556";
export const COMPOSITION_CLASS = "Q105543609";
export const SONG_FORM = "Q7366";
export const TRACK_UNIT = "Q7302866";
export const SECOND_UNIT = "Q11574";
export const EP_CLASS = "Q169930";

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

/**
 * The tracks an existing album already lists (P658) that the form doesn't use.
 * Any at all means the album has a tracklist this run would add a second one
 * beside, so the run is refused. Tracks the form reuses don't count, so
 * starting a failed run again (its tracklist half added) still works.
 */
export function foreignTracks(state: State, listed: readonly string[]): string[] {
  const own = new Set(state.discs.flatMap((d) => Object.values(d.track).map((q) => q.trim())));
  return listed.filter((q) => !own.has(q));
}

export const isCustomLang = (s: Settings) =>
  !!s.p407Custom || (s.p407.trim() !== "" && !KNOWN_LANGS.has(s.p407.trim()));
export const isCustomLabelLang = (s: Settings) =>
  !!s.langCustom || (s.lang.trim() !== "" && !KNOWN_LABEL_LANGS.has(s.lang.trim()));
export const isCustomPart = (d: Disc) =>
  !!d.partCustom || (d.part.trim() !== "" && !KNOWN_PARTS.has(d.part.trim()));

export function splitArtists(s: string, split: boolean): string[] {
  if (!split) return [s.trim()];
  return s
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

const LINE =
  /^\s*(\d+)\s*[.)]?\s+(.+)\s+[-–—]\s+(.+?)\s*\(\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*\)\s*$/;

export function parseDisc(text: string, settings: Settings): Row[] {
  const straighten = (s: string) =>
    settings.straight ? s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"') : s;
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = LINE.exec(line);
    if (!m) {
      rows.push({ error: "Couldn't read this line", raw: line });
      continue;
    }
    rows.push({
      n: +m[1],
      title: straighten(m[2].trim()),
      artists: splitArtists(m[3], settings.splitArtists),
      seconds: (m[4] ? +m[4] : 0) * 3600 + +m[5] * 60 + +m[6],
      raw: line,
    });
  }
  return rows;
}

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

const joinNames = (a: string[]) =>
  a.length < 2 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

function fillDesc(tpl: string, year: string, artists: string[], type = ""): string {
  return tpl
    .replace(/\{year\}/g, year)
    .replace(/\{artists\}/g, joinNames(artists))
    .replace(/\{type\}/g, type)
    .replace(/\s+/g, " ")
    .replace(/\s+([;,])/g, "$1")
    .replace(/[;,]\s*$/, "")
    .trim();
}

const item = (id: string): Value => ({ type: "item", id });
const ref = (key: string): Value => ({ type: "item", ref: key });
const claim = (property: string, value: Value, qualifiers?: Snak[]): Claim =>
  qualifiers?.length ? { property, value, qualifiers } : { property, value };

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface PlanItem {
  r: ParsedRow;
  di: number;
  part: string | null;
  perf: string[];
  existComp: string | null;
  existTrack: string | null;
  single: { date: ParsedDate; qid: string | null } | null;
}

/** Wikidata's limit on a label or description. */
export const MAX_TERM_LENGTH = 250;
/** Length as Wikidata counts it, in code points rather than UTF-16 units. */
const chars = (s: string) => s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

/** More tracks than this on one disc is likely a paste gone wrong. */
export const MAX_TRACKS_PER_DISC = 50;
/** Tracks per run, across all discs; a bigger release goes in several runs. */
export const MAX_TRACKS = 100;
/** A backstop on edits per run. At most ~4 per track (composition, track,
 * single, and linking the single), so MAX_TRACKS keeps runs well under it. */
export const MAX_OPS = 500;

export function buildPlan(state: State): Plan {
  const S = state.settings;
  const lang = S.lang.trim();
  const fieldErrs: Record<string, string> = {};
  const singleErrs: Record<string, string> = {};
  const messages: Msg[] = [];
  const err = (text: string) => messages.push(["err", text]);

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
  fieldErrs.compDesc = checkTemplate(S.compDesc, date).join(" ");
  fieldErrs.trackDesc = checkTemplate(S.trackDesc, date).join(" ");
  // {year} comes from each single's own date, which a new single must have.
  fieldErrs.singleDesc = checkTemplate(S.singleDesc, {
    ok: true,
    val: { time: "", precision: 9 },
    year: "0",
  }).join(" ");

  const parsed = state.discs.map((d) => parseDisc(d.text, S));
  const unmapped = new Set<string>();
  const badPerf = new Set<string>();
  const invalid: string[] = [];
  let readErr = 0;
  const perfFor = (names: string[]) => {
    const perf = names.map((a) => (state.artists[a] ?? "").trim());
    names.forEach((a, i) => {
      if (!perf[i]) unmapped.add(a);
      else if (!QID.test(perf[i])) badPerf.add(a);
    });
    return perf.filter((x) => QID.test(x));
  };

  /* album */
  const A = state.album;
  const creatingAlbum = A.mode === "create";
  const albumArtists = creatingAlbum ? splitArtists(A.artists, S.splitArtists).filter(Boolean) : [];
  const albumPerf = perfFor(albumArtists);
  const albumTitle = creatingAlbum
    ? S.straight
      ? A.title
          .trim()
          .replace(/[’‘]/g, "'")
          .replace(/[“”]/g, '"')
      : A.title.trim()
    : "";
  const albumTypeLabel = A.form
    ? (ALBUM_FORMS.find(([q]) => q === A.form)?.[1] ?? "album")
    : A.type === EP_CLASS
      ? "EP"
      : "album";
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
    if (!albumArtists.length) fieldErrs.albumArtists = "Enter at least one album artist.";
    fieldErrs.albumDesc = checkTemplate(S.albumDesc, date, ["year", "type", "artists"]).join(" ");
    for (const f of ALBUM_ID_FIELDS) {
      const v = (A.ids[f.key] ?? "").trim();
      fieldErrs[`albumId-${f.key}`] = "";
      if (!v) continue;
      if (!f.pattern.test(v))
        fieldErrs[`albumId-${f.key}`] = `That doesn't look like a ${f.label}.`;
      else albumIds.push(claim(f.property, { type: "string", value: v }));
    }
  }
  const albumErr =
    !!(fieldErrs.albumQid || fieldErrs.albumTitle || fieldErrs.albumArtists) ||
    blocking(fieldErrs.albumDesc) ||
    ALBUM_ID_FIELDS.some((f) => !!fieldErrs[`albumId-${f.key}`]);
  const album: ItemRef = creatingAlbum ? { ref: "album" } : { id: A.qid.trim() };
  const albumValue: Value = { type: "item", ...album };

  /* rows */
  const items: PlanItem[] = [];
  parsed.forEach((rows, di) => {
    const d = state.discs[di];
    const part = d.part.trim();
    if (part && !QID.test(part)) invalid.push(`Disc ${di + 1} part "${part}"`);
    for (const r of rows) {
      if (r.error !== undefined) {
        readErr++;
        continue;
      }
      const perf = perfFor(r.artists);
      const ec = (d.comp[r.n] ?? "").trim();
      const et = (d.track[r.n] ?? "").trim();
      if (ec && !QID.test(ec)) invalid.push(`Disc ${di + 1} track ${r.n} composition "${ec}"`);
      if (et && !QID.test(et)) invalid.push(`Disc ${di + 1} track ${r.n} track "${et}"`);
      let single: PlanItem["single"] = null;
      const sg = d.single[r.n];
      if (sg) {
        const sd = parseDate(sg.date ?? "");
        const sq = (sg.qid ?? "").trim();
        const errs: string[] = [];
        if ((sg.date ?? "").trim() && sq)
          errs.push("Give a release date for a new single or an existing single's QID, not both.");
        else if (!sd.ok) errs.push(sd.error);
        else if (!sd.val && !sq)
          errs.push("Enter the new single's release date, or an existing single's QID to reuse.");
        if (sq && !QID.test(sq)) errs.push(`"${sq}" isn't a QID.`);
        if (errs.length) singleErrs[`${di}:${r.n}`] = errs.join(" ");
        single = { date: sd, qid: QID.test(sq) ? sq : null };
      }
      items.push({
        r,
        di,
        part: QID.test(part) ? part : null,
        perf,
        existComp: QID.test(ec) ? ec : null,
        existTrack: QID.test(et) ? et : null,
        single,
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

  if (!items.length && !readErr) err("Paste at least one track into a disc.");
  parsed.forEach((rows, di) => {
    if (rows.length > MAX_TRACKS_PER_DISC)
      err(
        `Disc ${di + 1} has ${rows.length} tracks, but a disc can have at most ${MAX_TRACKS_PER_DISC}. ` +
          "Split it into more discs, or into separate runs.",
      );
  });
  const trackCount = parsed.reduce((n, rows) => n + rows.length, 0);
  if (trackCount > MAX_TRACKS)
    err(
      `That's ${trackCount} tracks across all discs, but a run can have at most ${MAX_TRACKS}. ` +
        "Split the release into separate runs.",
    );
  if (albumErr) err("Fix the album details at the top of the page.");
  if (readErr)
    err(
      `${readErr} line(s) couldn't be read. They're marked in the disc tables. Fix or remove them.`,
    );
  if (dupes.size) err(`Track numbers repeat within a disc: ${[...dupes].join(", ")}.`);
  if (badPerf.size) err(`Performer QID isn't valid for: ${[...badPerf].join(", ")}.`);
  if (unmapped.size) err(`No performer QID for: ${[...unmapped].join(", ")}.`);
  if (invalid.length) err(`Not a QID: ${invalid.join(", ")}.`);
  const settingsErr =
    !!fieldErrs.lang ||
    !!fieldErrs.date ||
    !!fieldErrs.p407 ||
    blocking(fieldErrs.compDesc) ||
    blocking(fieldErrs.trackDesc);
  if (settingsErr) err("Fix the errors in Item settings.");
  if (Object.keys(singleErrs).length)
    err(
      `${Object.keys(singleErrs).length} single(s) have errors. They're marked in the disc tables.`,
    );
  if (items.some((it) => it.single) && blocking(fieldErrs.singleDesc))
    err("Fix the single description template in Item settings.");

  const blocked = messages.some((m) => m[0] === "err");
  if (blocked) return { parsed, fieldErrs, singleErrs, messages, ops: [], ready: false };

  /* operations */
  const ops: Op[] = [];
  const year = date.ok ? date.year : "";
  const pubDate = date.ok && date.val ? [claim("P577", { type: "time", ...date.val })] : [];
  const workLang = p407ok ? [claim("P407", item(p407))] : [];
  const title = (t: string) => claim("P1476", { type: "monolingual", text: t, language: lang });
  const labelled = (t: string, desc: string) => ({
    labels: { [lang]: t },
    descriptions: desc ? { [lang]: desc } : {},
  });
  const compKey = (it: PlanItem) => `comp:${it.di}:${it.r.n}`;
  const trackKey = (it: PlanItem) => `track:${it.di}:${it.r.n}`;
  const where = (it: PlanItem) => `track ${it.di + 1}.${it.r.n} “${it.r.title}”`;

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
      ...labelled(albumTitle, fillDesc(S.albumDesc, year, albumArtists, albumTypeLabel)),
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
    if (it.existComp) {
      if (S.extendExisting && perf.length)
        ops.push({
          op: "addClaims",
          target: { id: it.existComp },
          what: `composition for ${where(it)}`,
          claims: perf,
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
        ...workLang,
        ...pubDate,
      ],
    });
  }

  // 3. Tracks, each linked to its composition.
  const compOf = (it: PlanItem): Value => (it.existComp ? item(it.existComp) : ref(compKey(it)));
  for (const it of items) {
    const publishedIn = S.publishedIn ? [claim("P1433", albumValue)] : [];
    const perf = it.perf.map((p) => claim("P175", item(p)));
    if (it.existTrack) {
      if (S.extendExisting)
        ops.push({
          op: "addClaims",
          target: { id: it.existTrack },
          what: where(it),
          claims: [claim("P2550", compOf(it)), ...publishedIn, ...perf],
        });
      continue;
    }
    ops.push({
      op: "create",
      key: trackKey(it),
      kind: "track",
      ...labelled(it.r.title, fillDesc(S.trackDesc, year, it.r.artists)),
      claims: [
        claim("P31", item(S.trackType)),
        title(it.r.title),
        ...perf,
        claim("P2550", compOf(it)),
        ...(S.duration
          ? [claim("P2047", { type: "quantity", amount: it.r.seconds, unit: SECOND_UNIT })]
          : []),
        ...workLang,
        ...publishedIn,
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

  // 5. Singles, each pointing at its track and the album; then track → single.
  let made = 0;
  let reused = 0;
  for (const it of items) {
    const sg = it.single;
    if (!sg) continue;
    const tracklist = claim("P658", trackOf(it), [
      { property: "P1545", value: { type: "string", value: "1" } },
    ]);
    const takenFrom = claim("P13602", albumValue);
    let single: Value;
    if (sg.qid) {
      reused++;
      single = item(sg.qid);
      ops.push({
        op: "addClaims",
        target: { id: sg.qid },
        what: `single for ${where(it)}`,
        claims: [
          tracklist,
          takenFrom,
          ...(S.extendExisting ? it.perf.map((p) => claim("P175", item(p))) : []),
        ],
      });
    } else {
      made++;
      const key = `single:${it.di}:${it.r.n}`;
      single = ref(key);
      const sd = sg.date.ok ? sg.date : null;
      ops.push({
        op: "create",
        key,
        kind: "single",
        ...labelled(it.r.title, fillDesc(S.singleDesc, sd?.year ?? "", it.r.artists)),
        claims: [
          claim("P31", item(SINGLE_CLASS)),
          title(it.r.title),
          ...it.perf.map((p) => claim("P175", item(p))),
          ...(sd?.val ? [claim("P577", { type: "time", ...sd.val })] : []),
          ...workLang,
          tracklist,
          takenFrom,
        ],
      });
    }
    if (S.publishedIn)
      ops.push({
        op: "addClaims",
        target: it.existTrack ? { id: it.existTrack } : { ref: trackKey(it) },
        what: where(it),
        claims: [claim("P1433", single)],
      });
  }

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
    );
    return { parsed, fieldErrs, singleErrs, messages, ops: [], ready: false };
  }

  if (ops.length > MAX_OPS) {
    err(
      `That's ${ops.length} edits, but a run can make at most ${MAX_OPS}. Split it into smaller runs.`,
    );
    return { parsed, fieldErrs, singleErrs, messages, ops: [], ready: false };
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
      ...(made || reused ? [`${made} single(s) to create, ${reused} reused`] : []),
    ].join(". ") + ".",
  ]);
  return { parsed, fieldErrs, singleErrs, messages, ops, ready: ops.length > 0 };
}

// ---------------------------------------------------------------------------
// Describing operations
// ---------------------------------------------------------------------------

const KIND_NAMES: Record<string, string> = {
  album: "album",
  ep: "EP",
  single: "single",
  work: "composition",
  track: "track",
};

/**
 * What an operation does, in a few words: the run log's line for it and the
 * preview's heading. A create's is what it makes, e.g. `track “Versailles”`.
 */
export function describeOp(op: Op): string {
  if (op.op === "addClaims") {
    const n = op.claims.length;
    return `Add ${n} statement${n === 1 ? "" : "s"} to ${op.what}`;
  }
  const label = Object.values(op.labels)[0] ?? "";
  return `${KIND_NAMES[op.kind] ?? "item"} “${label}”`;
}
