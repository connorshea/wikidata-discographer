// The default form state, and `coerceState`, which turns anything (saved browser
// state from an older version, or a request body) into a well-formed `State`.
import type {
  AlbumMb,
  Disc,
  MbCited,
  MbRowIds,
  Settings,
  SingleState,
  State,
  Track,
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
  singleDesc: "{year} single by {artists}",
  albumDesc: "{year} {type} by {artists}",
  compPerformer: true,
  straight: true,
  extendExisting: true,
  mbIds: true,
};

export const emptyDisc = (): Disc => ({
  part: "",
  tracks: [],
  comp: {},
  track: {},
  single: {},
});

export const EMPTY: State = {
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

/** Imported identifiers, keeping only well-formed ones. */
function coerceMbIds(ids: Obj): MbRowIds {
  return {
    recording: matching(ids.recording, MBID_PATTERN),
    work: matching(ids.work, MBID_PATTERN),
    iswcs: strList(ids.iswcs, ISWC_PATTERN),
    isrcs: strList(ids.isrcs, ISRC_PATTERN),
    spotify: strList(ids.spotify, SPOTIFY_TRACK_PATTERN),
    appleMusic: strList(ids.appleMusic, APPLE_MUSIC_TRACK_PATTERN),
    deezer: strList(ids.deezer, DEEZER_TRACK_PATTERN),
    tidal: strList(ids.tidal, TIDAL_TRACK_PATTERN),
    // Forms saved before identifiers had references kept the source with the length.
    source: coerceSource(ids.source ?? ids.length),
  };
}

const seconds = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);

function coerceTrack(t: Obj): Track | null {
  if (!Number.isInteger(t.n) || (t.n as number) < 0) return null;
  return {
    n: t.n as number,
    title: str(t.title),
    artists: Array.isArray(t.artists)
      ? t.artists.filter((a): a is string => typeof a === "string" && a.trim() !== "")
      : [],
    seconds: seconds(t.seconds),
    mb: isObj(t.mb) ? coerceMbIds(t.mb) : null,
  };
}

const SEPARATOR = /(\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s+)/i;

/**
 * Artist names written as "A, B & C feat. D", as forms saved them before
 * artists were kept one by one. A name in `whole`, such as "Tyler, the
 * Creator", isn't split up.
 */
function splitArtists(s: string, whole: Iterable<string> = []): string[] {
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
        artists: split ? splitArtists(m[3]) : [m[3].trim()],
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
    straight: bool(s.straight, d.straight),
    extendExisting: bool(s.extendExisting, d.extendExisting),
    mbIds: bool(s.mbIds, d.mbIds),
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
    mb: coerceAlbumMb(a.mb),
  };
  if (album.form && !/^Q\d+$/.test(album.form)) album.form = "";
  const discs = (Array.isArray(r.discs) ? r.discs : []).filter(isObj).map((disc): Disc => ({
    part: str(disc.part),
    partCustom: bool(disc.partCustom, false),
    tracks: Array.isArray(disc.tracks)
      ? disc.tracks.filter(isObj).flatMap((t) => coerceTrack(t) ?? [])
      : legacyTracks(str(disc.text), s.splitArtists !== false, isObj(disc.mb) ? disc.mb : {}),
    comp: strMap(disc.comp),
    track: strMap(disc.track),
    single: isObj(disc.single)
      ? Object.fromEntries(
          Object.entries(disc.single)
            .filter((e): e is [string, Obj] => isObj(e[1]))
            .map(([n, sg]): [string, SingleState] => [
              n,
              { date: str(sg.date), qid: str(sg.qid), discogs: str(sg.discogs) },
            ]),
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
