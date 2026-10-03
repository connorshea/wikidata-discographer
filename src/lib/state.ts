// Default form states, and `coerceState`, which turns anything (saved browser
// state from an older version, or a request body) into a well-formed `State`.
import type { Disc, Settings, SingleState, State } from "./plan.ts";

const DEFAULT_SETTINGS: Settings = {
  lang: "en",
  date: "",
  p407: "",
  compDesc: "{year} song by {artists}",
  trackDesc: "vocal track by {artists}; {year} studio recording",
  trackType: "Q55850593",
  singleDesc: "{year} single by {artists}",
  albumDesc: "{year} {type} by {artists}",
  compPerformer: true,
  duration: true,
  publishedIn: true,
  straight: false,
  splitArtists: true,
  extendExisting: true,
};

export const emptyDisc = (): Disc => ({ part: "", text: "", comp: {}, track: {}, single: {} });

export const EMPTY: State = {
  settings: DEFAULT_SETTINGS,
  album: {
    mode: "existing",
    qid: "",
    title: "",
    artists: "",
    type: "Q482994",
    form: "Q208569",
    ids: { spotify: "", musicbrainz: "", appleMusic: "" },
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
    publishedIn: bool(s.publishedIn, d.publishedIn),
    straight: bool(s.straight, d.straight),
    splitArtists: bool(s.splitArtists, d.splitArtists),
    extendExisting: bool(s.extendExisting, d.extendExisting),
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
  }));
  return {
    settings,
    album,
    artists: strMap(r.artists),
    discs: discs.length ? discs : [emptyDisc()],
  };
}
