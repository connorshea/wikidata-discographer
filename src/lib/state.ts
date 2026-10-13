// The default form state, and `coerceState`, which turns anything (saved browser
// state from an older version, or a request body) into a well-formed `State`.
import type {
  AlbumMb,
  Disc,
  LabelsMb,
  MbCited,
  MbRowIds,
  Settings,
  SingleState,
  State,
} from "./plan.ts";
import {
  ALBUM_ID_FIELDS,
  APPLE_MUSIC_TRACK_PATTERN,
  ISRC_PATTERN,
  MBID_PATTERN,
  SPOTIFY_TRACK_PATTERN,
} from "./music.ts";

const DEFAULT_SETTINGS: Settings = {
  lang: "en",
  date: "",
  p407: "",
  compDesc: "{year} song by {artists}",
  trackDesc: "vocal track by {artists}",
  trackType: "Q55850593",
  singleDesc: "{year} single by {artists}",
  albumDesc: "{year} {type} by {artists}",
  compPerformer: true,
  duration: true,
  straight: true,
  splitArtists: true,
  extendExisting: true,
  mbIds: true,
  mbRefs: true,
};

export const emptyDisc = (): Disc => ({
  part: "",
  text: "",
  comp: {},
  track: {},
  single: {},
  mb: {},
});

export const EMPTY: State = {
  settings: DEFAULT_SETTINGS,
  album: {
    mode: "existing",
    qid: "",
    title: "",
    artists: "",
    type: "Q482994",
    form: "Q208569",
    ids: { spotify: "", musicbrainz: "", appleMusic: "", discogs: "" },
    mb: null,
    labels: "",
    labelsMb: null,
  },
  artists: {},
  discs: [emptyDisc()],
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const strMap = (v: unknown): Record<string, string> =>
  isObj(v)
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"),
      )
    : {};

const strList = (v: unknown, pattern: RegExp): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && pattern.test(x)))]
    : [];
const matching = (v: unknown, pattern: RegExp) =>
  typeof v === "string" && pattern.test(v) ? v : "";

/** Imported identifiers, keeping only well-formed ones. */
function coerceMbIds(ids: Obj): MbRowIds {
  // Forms saved before identifiers had references kept the source with the length.
  const legacy = isObj(ids.length) ? ids.length : null;
  const source = coerceSource(ids.source ?? legacy);
  const seconds = legacy ? legacy.seconds : ids.length;
  return {
    title: str(ids.title),
    recording: matching(ids.recording, MBID_PATTERN),
    work: matching(ids.work, MBID_PATTERN),
    isrcs: strList(ids.isrcs, ISRC_PATTERN),
    spotify: strList(ids.spotify, SPOTIFY_TRACK_PATTERN),
    appleMusic: strList(ids.appleMusic, APPLE_MUSIC_TRACK_PATTERN),
    source,
    length: Number.isInteger(seconds) && (seconds as number) >= 0 ? (seconds as number) : null,
  };
}

/** A real day written YYYY-MM-DD, or "". */
function day(v: unknown): string {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().startsWith(m[0])
    ? m[0]
    : "";
}

/** The recording and day an import came from, or null unless both are well-formed. */
function coerceSource(v: unknown): MbRowIds["source"] {
  if (!isObj(v)) return null;
  const recording = matching(v.recording, MBID_PATTERN);
  const retrieved = day(v.retrieved);
  return recording && retrieved ? { recording, retrieved } : null;
}

function coerceCited(v: unknown): MbCited | null {
  return isObj(v) &&
    typeof v.value === "string" &&
    v.value !== "" &&
    (v.from === "releaseGroup" || v.from === "release")
    ? { value: v.value, from: v.from }
    : null;
}

/** Where an import's album details came from, or null unless its IDs and day are well-formed. */
function coerceAlbumMb(v: unknown): AlbumMb | null {
  if (!isObj(v)) return null;
  const releaseGroup = matching(v.releaseGroup, MBID_PATTERN);
  const release = matching(v.release, MBID_PATTERN);
  const retrieved = day(v.retrieved);
  if (!releaseGroup || !release || !retrieved) return null;
  const ids: AlbumMb["ids"] = {};
  for (const f of ALBUM_ID_FIELDS) {
    // The release group ID is what the others are cited to, so it never cites itself.
    if (f.key === "musicbrainz") continue;
    const cited = isObj(v.ids) ? coerceCited(v.ids[f.key]) : null;
    if (cited) ids[f.key] = cited;
  }
  return { releaseGroup, release, retrieved, date: coerceCited(v.date), ids };
}

/** Where an import's record labels came from, or null unless its release, day and QIDs are well-formed. */
function coerceLabelsMb(v: unknown): LabelsMb | null {
  if (!isObj(v)) return null;
  const release = matching(v.release, MBID_PATTERN);
  const retrieved = day(v.retrieved);
  const qids = strList(v.qids, /^Q\d+$/);
  return release && retrieved && qids.length ? { release, retrieved, qids } : null;
}

/** A well-formed copy of `raw`, filling anything missing or mistyped with defaults. */
export function coerceState(raw: unknown): State {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.settings) ? r.settings : {};
  const d = DEFAULT_SETTINGS;
  const settings: Settings = {
    lang: str(s.lang, d.lang),
    langCustom: bool(s.langCustom, false),
    date: str(s.date),
    p407: str(s.p407),
    p407Custom: bool(s.p407Custom, false),
    compDesc: str(s.compDesc, d.compDesc),
    trackDesc: str(s.trackDesc, d.trackDesc),
    trackType: ["Q55850593", "Q55850643", "Q7302866"].includes(str(s.trackType))
      ? str(s.trackType)
      : d.trackType,
    singleDesc: str(s.singleDesc, d.singleDesc),
    albumDesc: str(s.albumDesc, d.albumDesc),
    compPerformer: bool(s.compPerformer, d.compPerformer),
    duration: bool(s.duration, d.duration),
    straight: bool(s.straight, d.straight),
    splitArtists: bool(s.splitArtists, d.splitArtists),
    extendExisting: bool(s.extendExisting, d.extendExisting),
    mbIds: bool(s.mbIds, d.mbIds),
    mbRefs: bool(s.mbRefs, d.mbRefs),
  };
  const a = isObj(r.album) ? r.album : {};
  const ids = isObj(a.ids) ? a.ids : {};
  const album: State["album"] = {
    mode: a.mode === "create" ? "create" : "existing",
    qid: str(a.qid),
    title: str(a.title),
    artists: str(a.artists),
    type: a.type === "Q169930" ? "Q169930" : "Q482994",
    form: str(a.form, EMPTY.album.form),
    ids: {
      spotify: str(ids.spotify),
      musicbrainz: str(ids.musicbrainz),
      appleMusic: str(ids.appleMusic),
      discogs: str(ids.discogs),
    },
    mb: coerceAlbumMb(a.mb),
    labels: str(a.labels),
    labelsMb: coerceLabelsMb(a.labelsMb),
  };
  if (album.form && !/^Q\d+$/.test(album.form)) album.form = "";
  const discs = (Array.isArray(r.discs) ? r.discs : []).filter(isObj).map((disc): Disc => ({
    part: str(disc.part),
    partCustom: bool(disc.partCustom, false),
    text: str(disc.text),
    comp: strMap(disc.comp),
    track: strMap(disc.track),
    single: isObj(disc.single)
      ? Object.fromEntries(
          Object.entries(disc.single)
            .filter((e): e is [string, Obj] => isObj(e[1]))
            .map(([n, sg]): [string, SingleState] => [n, { date: str(sg.date), qid: str(sg.qid) }]),
        )
      : {},
    mb: isObj(disc.mb)
      ? Object.fromEntries(
          Object.entries(disc.mb)
            .filter((e): e is [string, Obj] => isObj(e[1]))
            .map(([n, ids]): [string, MbRowIds] => [n, coerceMbIds(ids)]),
        )
      : {},
  }));
  return {
    settings,
    album,
    artists: strMap(r.artists),
    discs: discs.length ? discs : [emptyDisc()],
  };
}
