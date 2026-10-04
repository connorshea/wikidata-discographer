// Default form states, and `coerceState`, which turns anything (saved browser
// state from an older version, or a request body) into a well-formed `State`.
import type { Disc, MbRowIds, Settings, SingleState, State } from "./plan.ts";
import { ISRC_PATTERN, MBID_PATTERN, SPOTIFY_TRACK_PATTERN } from "./music.ts";

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
  straight: false,
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
  },
  artists: {},
  discs: [emptyDisc()],
};

export const EXAMPLE: State = {
  settings: { ...DEFAULT_SETTINGS, date: "2026-09-18", p407: "Q1860" },
  album: { ...EMPTY.album, qid: "Q140316456", title: "Day and Night", artists: "Carly Rae Jepsen" },
  artists: { "Carly Rae Jepsen": "Q52583" },
  discs: [
    {
      part: "Q61629664",
      comp: { "1": "Q140882264" },
      track: {},
      single: {},
      mb: {},
      text: `1. After All - Carly Rae Jepsen (04:12)
2. Habits of Creatures - Carly Rae Jepsen (02:57)
3. Versailles - Carly Rae Jepsen (03:14)
4. On Wires - Carly Rae Jepsen (03:22)
5. Blue Skies - Carly Rae Jepsen (02:29)
6. Burning Heart - Carly Rae Jepsen (03:30)
7. Wild Child - Carly Rae Jepsen (03:49)
8. Good Fine Alright - Carly Rae Jepsen (04:09)
9. Something Tragic - Carly Rae Jepsen (02:57)
10. Soft - Carly Rae Jepsen (03:03)
11. Lonely Side of the Bed - Carly Rae Jepsen (03:30)
12. Just a Little Walk on the Moon - Carly Rae Jepsen (03:48)`,
    },
    {
      part: "Q61629680",
      comp: {},
      track: {},
      single: {},
      mb: {},
      text: `1. Never Let a Good Thing Die - Carly Rae Jepsen (05:19)
2. Amalfi Coast - Carly Rae Jepsen (02:59)
3. Patience Power Passion - Carly Rae Jepsen (03:29)
4. Don’t Leave Me on the Dance Floor - Carly Rae Jepsen (03:12)
5. Motivation - Carly Rae Jepsen (03:53)
6. You Don’t Know How It Feels - Carly Rae Jepsen (03:14)
7. Near or Far - Carly Rae Jepsen (03:17)
8. Diver - Carly Rae Jepsen (03:06)
9. Hold Me to the Light - Carly Rae Jepsen (03:56)
10. That’s Just Me - Carly Rae Jepsen (03:42)
11. No Labels, I Love You - Carly Rae Jepsen (03:40)
12. Super Sage - Carly Rae Jepsen (04:01)`,
    },
  ],
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
    title: str(ids.title),
    recording: matching(ids.recording, MBID_PATTERN),
    work: matching(ids.work, MBID_PATTERN),
    isrcs: strList(ids.isrcs, ISRC_PATTERN),
    spotify: strList(ids.spotify, SPOTIFY_TRACK_PATTERN),
    length: coerceLength(ids.length),
  };
}

/** An imported length and its source, or null unless all of it is well-formed. */
function coerceLength(v: unknown): MbRowIds["length"] {
  if (!isObj(v)) return null;
  const { seconds, recording, retrieved } = v;
  const day = typeof retrieved === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(retrieved) : null;
  const real =
    day && new Date(Date.UTC(+day[1], +day[2] - 1, +day[3])).toISOString().startsWith(day[0]);
  return Number.isInteger(seconds) &&
    (seconds as number) >= 0 &&
    typeof recording === "string" &&
    MBID_PATTERN.test(recording) &&
    real
    ? { seconds: seconds as number, recording, retrieved: day[0] }
    : null;
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
