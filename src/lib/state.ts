// The default form state, and `coerceState`, which turns anything (saved browser
// state from an older version, or a request body) into a well-formed `State`.
import {
  knownRecTypes,
  MB_ATTRIBUTES,
  parseDate,
  TRACK_TYPES,
  type AlbumMb,
  type Disc,
  type MbCited,
  type MbRowIds,
  type MbWriter,
  type Settings,
  type StartingPoint,
  type State,
  type Track,
} from "./plan.ts";
import { sameTitle } from "./titles.ts";
import {
  ALBUM_ID_FIELDS,
  APPLE_MUSIC_TRACK_PATTERN,
  DEEZER_TRACK_PATTERN,
  TIDAL_TRACK_PATTERN,
  ISRC_PATTERN,
  ISWC_PATTERN,
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
  albumDesc: "{year} {type} by {artists}",
  compPerformer: true,
  straight: true,
  extendExisting: true,
  mbWriters: true,
  mbDetails: true,
  recDate: "",
  recTypes: [],
};

export const emptyDisc = (): Disc => ({
  part: "",
  tracks: [],
  comp: {},
  track: {},
});

export const EMPTY: State = {
  start: null,
  settings: DEFAULT_SETTINGS,
  album: {
    mode: "existing",
    qid: "",
    title: "",
    artists: [],
    type: "Q482994",
    form: "Q208569",
    ids: {
      spotify: "",
      musicbrainz: "",
      appleMusic: "",
      deezer: "",
      tidal: "",
      allmusic: "",
      discogs: "",
    },
    release: "",
    mb: null,
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

/** Imported composers or lyricists, each artist once, keeping only well-formed ones. */
function writers(v: unknown): MbWriter[] {
  if (!Array.isArray(v)) return [];
  const out = new Map<string, MbWriter>();
  for (const w of v.filter(isObj)) {
    const id = matching(w.id, MBID_PATTERN);
    const name = str(w.name).trim();
    if (id && name && !out.has(id)) out.set(id, { id, name });
  }
  return [...out.values()];
}

/** A date MusicBrainz writes YYYY, YYYY-MM or YYYY-MM-DD, as the form reads one. */
const mbDate = (v: unknown) => (typeof v === "string" && v && parseDate(v).ok ? v : "");

function coerceRecorded(v: unknown): MbRowIds["recorded"] {
  if (!isObj(v)) return undefined;
  const begin = mbDate(v.begin);
  const end = mbDate(v.end);
  return begin ? { begin, end: end !== begin ? end : "" } : undefined;
}

const isTrackType = (v: unknown): v is string => TRACK_TYPES.some(([q]) => q === v);

/** Imported identifiers, keeping only well-formed ones. */
function coerceMbIds(ids: Obj): MbRowIds {
  const languages = strList(ids.languages, /^Q\d+$/);
  const recorded = coerceRecorded(ids.recorded);
  const attributes = MB_ATTRIBUTES.filter(
    (a) => Array.isArray(ids.attributes) && ids.attributes.includes(a),
  );
  return {
    recording: matching(ids.recording, MBID_PATTERN),
    work: matching(ids.work, MBID_PATTERN),
    recordingName: str(ids.recordingName),
    workName: str(ids.workName),
    iswcs: strList(ids.iswcs, ISWC_PATTERN),
    isrcs: strList(ids.isrcs, ISRC_PATTERN),
    spotify: strList(ids.spotify, SPOTIFY_TRACK_PATTERN),
    appleMusic: strList(ids.appleMusic, APPLE_MUSIC_TRACK_PATTERN),
    deezer: strList(ids.deezer, DEEZER_TRACK_PATTERN),
    tidal: strList(ids.tidal, TIDAL_TRACK_PATTERN),
    composers: writers(ids.composers),
    lyricists: writers(ids.lyricists),
    ...(attributes.length ? { attributes } : {}),
    ...(languages.length ? { languages } : {}),
    ...(recorded ? { recorded } : {}),
    // Forms saved before identifiers had references kept the source with the length.
    source: coerceSource(ids.source ?? ids.length),
  };
}

const seconds = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);

function coerceTrack(t: Obj): Track | null {
  if (!Number.isInteger(t.n) || (t.n as number) < 0) return null;
  const artists = Array.isArray(t.artists)
    ? t.artists.filter((a): a is string => typeof a === "string" && a.trim() !== "")
    : [];
  const featured: unknown[] = Array.isArray(t.feat) ? t.feat : [];
  const feat = artists.filter((a) => featured.includes(a));
  return {
    n: t.n as number,
    title: str(t.title),
    artists,
    ...(feat.length ? { feat } : {}),
    seconds: seconds(t.seconds),
    ...(typeof t.length === "string" ? { length: t.length } : {}),
    mb: isObj(t.mb) ? coerceMbIds(t.mb) : null,
    ...(isTrackType(t.type) ? { type: t.type } : {}),
    ...(typeof t.p407 === "string" ? { p407: t.p407 } : {}),
    ...(t.p407Custom === true ? { p407Custom: true } : {}),
    ...(typeof t.recorded === "string" && t.recorded.trim() ? { recorded: t.recorded } : {}),
    // A set of only types the form doesn't know isn't one of none, so the album's applies.
    ...(Array.isArray(t.recTypes) && (!t.recTypes.length || knownRecTypes(t.recTypes).length)
      ? { recTypes: knownRecTypes(t.recTypes) }
      : {}),
  };
}

const SEPARATOR = /(\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s+)/i;

/**
 * Artist names written as "A, B & C feat. D", as forms saved them before
 * artists were kept one by one. A name in `whole`, such as "Tyler, the
 * Creator", isn't split up.
 */
export function splitArtists(s: string, whole: Iterable<string> = []): string[] {
  const keep = new Set(whole);
  // Names at the even indexes, with the separators between them.
  const parts = s.split(SEPARATOR);
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    // The longest run of names from here that's one to keep whole.
    let j = parts.length - 1;
    while (
      j > i &&
      !keep.has(
        parts
          .slice(i, j + 1)
          .join("")
          .trim(),
      )
    )
      j -= 2;
    names.push(
      parts
        .slice(i, j + 1)
        .join("")
        .trim(),
    );
    i = j;
  }
  return names.filter(Boolean);
}

const FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/**
 * A row's artists as typed, "A, B feat. C": the names, split as `splitArtists`
 * splits them, and those after "feat.", which are featured.
 */
export function parseArtists(
  s: string,
  whole: Iterable<string> = [],
): Pick<Track, "artists" | "feat"> {
  const keep = [...whole];
  const m = FEAT.exec(s);
  if (!m) return { artists: splitArtists(s, keep) };
  const main = splitArtists(s.slice(0, m.index), keep);
  const feat = splitArtists(s.slice(m.index + m[0].length), keep).filter((n) => !main.includes(n));
  const artists = [...new Set([...main, ...feat])];
  return feat.length ? { artists, feat } : { artists };
}

/** A row's artists as `parseArtists` reads them back. */
export function artistsText(t: Pick<Track, "artists" | "feat">): string {
  const feat = t.feat ?? [];
  const main = t.artists.filter((a) => !feat.includes(a)).join(", ");
  return feat.length ? `${main} feat. ${feat.join(", ")}`.trim() : main;
}

const LEGACY_LINE =
  /^\s*(\d+)\s*[.)]?\s+(.+)\s+[-–—]\s+(.+?)\s*(?:\(\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*\))?\s*$/;

/**
 * The tracks of a disc saved as a tracklist with a line per track, as forms
 * were before tracks were kept one by one. Submitted forms are stored like
 * this too. Lines that can't be read are left out, and the identifiers a row
 * had are kept only while it has the title they were imported with.
 */
function legacyTracks(text: string, split: boolean, mb: Obj): Track[] {
  return text.split(/\r?\n/).flatMap((line): Track[] => {
    const m = LEGACY_LINE.exec(line);
    if (!m) return [];
    const title = m[2].trim();
    const ids = mb[String(+m[1])];
    return [
      {
        n: +m[1],
        title,
        ...(split ? parseArtists(m[3]) : { artists: [m[3].trim()] }),
        seconds: m[5] ? (m[4] ? +m[4] : 0) * 3600 + +m[5] * 60 + +m[6] : null,
        mb: isObj(ids) && sameTitle(str(ids.title), title) ? coerceMbIds(ids) : null,
      },
    ];
  });
}

/** A real day written YYYY-MM-DD, or "". */
function day(v: unknown): string {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().startsWith(m[0])
    ? m[0]
    : "";
}

/**
 * The recording, work and day an import came from, or null unless the recording and
 * day are well-formed.
 */
function coerceSource(v: unknown): MbRowIds["source"] {
  if (!isObj(v)) return null;
  const recording = matching(v.recording, MBID_PATTERN);
  const work = matching(v.work, MBID_PATTERN);
  const retrieved = day(v.retrieved);
  return recording && retrieved ? { recording, ...(work ? { work } : {}), retrieved } : null;
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
  return {
    releaseGroup,
    release,
    releaseGroupName: str(v.releaseGroupName),
    retrieved,
    date: coerceCited(v.date),
    ids,
  };
}

const STARTS: readonly StartingPoint[] = ["mb", "existing", "search", "new"];

/**
 * The starting point of a form saved before it had one: none for an empty
 * form, otherwise what it looks started from.
 */
function legacyStart(s: Omit<State, "start">): StartingPoint | null {
  if (s.album.mb) return "mb";
  if (s.album.mode === "existing" && s.album.qid.trim()) return "existing";
  const blank = JSON.stringify(coerceState({ ...s, start: null }));
  return blank === JSON.stringify(coerceState(EMPTY)) ? null : "new";
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
    trackType: isTrackType(s.trackType) ? s.trackType : d.trackType,
    albumDesc: str(s.albumDesc, d.albumDesc),
    compPerformer: bool(s.compPerformer, d.compPerformer),
    straight: bool(s.straight, d.straight),
    extendExisting: bool(s.extendExisting, d.extendExisting),
    mbWriters: bool(s.mbWriters, d.mbWriters),
    mbDetails: bool(s.mbDetails, d.mbDetails),
    recDate: str(s.recDate),
    recTypes: Array.isArray(s.recTypes) ? knownRecTypes(s.recTypes) : [],
  };
  const a = isObj(r.album) ? r.album : {};
  const ids = isObj(a.ids) ? a.ids : {};
  const album: State["album"] = {
    mode: a.mode === "create" ? "create" : "existing",
    qid: str(a.qid),
    title: str(a.title),
    artists: Array.isArray(a.artists)
      ? a.artists.filter((x): x is string => typeof x === "string")
      : typeof a.artists === "string" && s.splitArtists !== false
        ? splitArtists(a.artists, isObj(r.artists) ? Object.keys(r.artists) : [])
        : [str(a.artists).trim()].filter(Boolean),
    type: a.type === "Q169930" ? "Q169930" : "Q482994",
    form: str(a.form, EMPTY.album.form),
    ids: {
      spotify: str(ids.spotify),
      musicbrainz: str(ids.musicbrainz),
      appleMusic: str(ids.appleMusic),
      deezer: str(ids.deezer),
      tidal: str(ids.tidal),
      allmusic: str(ids.allmusic),
      discogs: str(ids.discogs),
    },
    release: "",
    mb: coerceAlbumMb(a.mb),
  };
  if (album.form && !/^Q\d+$/.test(album.form)) album.form = "";
  // A form saved before the release was kept on its own has it only in a new album's references.
  album.release = matching(a.release, MBID_PATTERN) || (album.mb?.release ?? "");
  const discs = (Array.isArray(r.discs) ? r.discs : []).filter(isObj).map((disc): Disc => ({
    part: str(disc.part),
    partCustom: bool(disc.partCustom, false),
    tracks: Array.isArray(disc.tracks)
      ? disc.tracks.filter(isObj).flatMap((t) => coerceTrack(t) ?? [])
      : legacyTracks(str(disc.text), s.splitArtists !== false, isObj(disc.mb) ? disc.mb : {}),
    comp: strMap(disc.comp),
    // A form saved while tracks could have singles drops them.
    track: strMap(disc.track),
  }));
  const rest = {
    settings,
    album,
    artists: strMap(r.artists),
    discs: discs.length ? discs : [emptyDisc()],
  };
  const start = "start" in r ? (STARTS.find((p) => p === r.start) ?? null) : legacyStart(rest);
  return { start, ...rest };
}
