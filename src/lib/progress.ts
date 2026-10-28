// What the progress rail and the plan panel show: each step's status and
// summary, what the run will create, and what still blocks it.
import {
  albumArtists,
  type BlockerAt,
  LABEL_LANGS,
  LANGS,
  NO_LINGUISTIC_CONTENT,
  type Plan,
  QID,
  recTypeName,
  type Settings,
  type StartingPoint,
  type State,
  releaseNoun,
  capitalized,
} from "./plan.ts";

export type StepId = "start" | "album" | "settings" | "tracks" | "performers" | "create";
export type StepStatus = "done" | "attention" | "pending";

export interface Step {
  id: StepId;
  name: string;
  summary: string;
  status: StepStatus;
  /** Can't be filled in yet: the steps after Start, until a starting point is picked. */
  locked: boolean;
}

/** A run in progress. `total` is 0 when it's followed in the background, counts unknown. */
export interface RunningInfo {
  done: number;
  total: number;
}

export interface ProgressInput {
  state: State;
  plan: Plan;
  /** Tracks with possible matches not yet used or dismissed. */
  unreviewed: number;
  /** The existing album already has a tracklist, so it can't be used. */
  hasTracklist: boolean;
  /** The existing album's QID can't be used: it doesn't exist, redirects, or isn't an album or EP. */
  notAlbum: boolean;
  running: RunningInfo | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every artist name the Performers table maps: the tracks' and a new album's. */
export function performerNames(state: State, plan: Plan): string[] {
  const names = new Set<string>();
  for (const t of plan.tracks.flat()) t.artists.forEach((a) => names.add(a));
  if (state.album.mode === "create") albumArtists(state).forEach((a) => names.add(a));
  return [...names];
}

/** A track in the tracklist: its disc and row, by index, with its number and title. */
export interface TrackAt {
  disc: number;
  row: number;
  n: number;
  title: string;
}

/**
 * The composers and lyricists the compositions get, by name, with the songs each
 * wrote: those of every imported track, with the setting on.
 */
export function writers(
  state: State,
  plan: Plan,
): Map<string, { composer: boolean; lyricist: boolean; songs: TrackAt[] }> {
  const out = new Map<string, { composer: boolean; lyricist: boolean; songs: TrackAt[] }>();
  if (!state.settings.mbWriters) return out;
  plan.tracks.forEach((rows, disc) => {
    rows.forEach((t, row) => {
      if (!t.mb) return;
      const names = new Set<string>();
      for (const [role, ws] of [
        ["composer", t.mb.composers],
        ["lyricist", t.mb.lyricists],
      ] as const)
        for (const w of ws) {
          const entry = out.get(w.name) ?? { composer: false, lyricist: false, songs: [] };
          entry[role] = true;
          out.set(w.name, entry);
          names.add(w.name);
        }
      for (const name of names) out.get(name)!.songs.push({ disc, row, n: t.n, title: t.title });
    });
  });
  return out;
}

export interface PerformerRow {
  name: string;
  /** The tracks that list them. */
  tracks: TrackAt[];
  /** One of the album artists, as entered for a new album or imported from MusicBrainz. */
  albumArtist: boolean;
  /** Whether they're a performer, whom the run needs a QID for. */
  performer: boolean;
  /** Composer or lyricist of some composition, and of which songs. */
  composer: boolean;
  lyricist: boolean;
  songs: TrackAt[];
}

/** Each name in People, in the table's order, with where it's used: performers, then writers. */
export function performerRows(state: State, plan: Plan): PerformerRow[] {
  const ofAlbum =
    state.album.mode === "create" || state.start === "mb" ? new Set(albumArtists(state)) : null;
  const tracks = plan.tracks.flatMap((rows, disc) =>
    rows.map((t, row) => ({ at: { disc, row, n: t.n, title: t.title }, artists: t.artists })),
  );
  const performers = new Set(performerNames(state, plan));
  const wrote = writers(state, plan);
  return [...new Set([...performers, ...wrote.keys()])].map((name) => ({
    name,
    tracks: tracks.filter((t) => t.artists.includes(name)).map((t) => t.at),
    albumArtist: ofAlbum?.has(name) ?? false,
    performer: performers.has(name),
    composer: wrote.get(name)?.composer ?? false,
    lyricist: wrote.get(name)?.lyricist ?? false,
    songs: wrote.get(name)?.songs ?? [],
  }));
}

/** Performer names with a valid QID, of all of them. */
export function linkedPerformers(state: State, plan: Plan): { linked: number; total: number } {
  const names = performerNames(state, plan);
  const linked = names.filter((n) => QID.test((state.artists[n] ?? "").trim())).length;
  return { linked, total: names.length };
}

const blockedAt = (plan: Plan, at: BlockerAt) => plan.blockers.includes(at);

/** The album step's summary, or null while nothing names the album yet. */
function albumSummary(state: State): string | null {
  const A = state.album;
  if (A.mode === "existing") return A.qid.trim() ? `Existing · ${A.qid.trim()}` : null;
  const title = A.title.trim();
  if (!title && !albumArtists(state).length) return null;
  return title ? `New · ${title}` : `New ${newNoun(state)}`;
}

/** A new release's noun, "single" or "album". */
const newNoun = (state: State) => releaseNoun({ ...state.album, mode: "create" });

/** What each starting point is called once the form is started from it. */
export const START_NAMES: Record<StartingPoint, string> = {
  mb: "MusicBrainz release",
  existing: "Album QID",
  search: "Search by name",
  new: "Entered by hand",
};

export interface StartSummary {
  /** Where the form was started from, e.g. "Started from MusicBrainz". */
  from: string;
  title: string;
  /** The rest, in order: artists, discs, tracks and whether the album is new. */
  details: string[];
}

/**
 * The summary bar's line once a starting point is applied. `albumLabel` is
 * the existing album's label on Wikidata, while it's known.
 */
export function startSummary(
  state: State,
  plan: Plan,
  albumLabel: string | null,
): StartSummary | null {
  const { start, album: A } = state;
  if (!start) return null;
  const trackCount = plan.tracks.reduce((n, rows) => n + rows.length, 0);
  const discCount = plan.tracks.filter((rows) => rows.length).length;
  const artists = albumArtists(state);
  const from = {
    mb: "Started from MusicBrainz",
    existing: "Started from an album QID",
    search: "Found by searching",
    new: `New ${newNoun(state)} from scratch`,
  }[start];
  const title =
    A.mode === "existing" ? (albumLabel ?? A.qid.trim()) || "No album picked" : A.title.trim();
  return {
    from,
    title: title || `Untitled ${newNoun(state)}`,
    details: [
      ...(artists.length ? [artists.join(", ")] : []),
      ...(trackCount ? [plural(discCount, "disc"), plural(trackCount, "track")] : []),
      ...(start === "mb" && A.mode === "create"
        ? [`not on Wikidata yet, so a new ${newNoun(state)} will be created`]
        : []),
    ],
  };
}

/** The label language's name, or its code when it isn't a listed one. */
const labelLangName = (S: Settings) =>
  LABEL_LANGS.find(([c]) => c === S.lang.trim())?.[1] ?? S.lang.trim();

/** The options Item settings lists as checkboxes. */
export const SETTING_FLAGS = ["compPerformer", "straight", "mbWriters"] as const;

/** Item settings in a few pills, for when the section is collapsed. */
export function settingsPills(S: Settings): string[] {
  const p407 = S.p407.trim();
  const work =
    p407 === NO_LINGUISTIC_CONTENT ? "no linguistic content" : LANGS.find(([q]) => q === p407)?.[1];
  const on = SETTING_FLAGS.filter((k) => S[k]).length;
  return [
    `Labels: ${labelLangName(S) || "none"}`,
    ...(p407 ? [`Language of work: ${work ? `${work} (${p407})` : p407}`] : []),
    S.date.trim() ? `Published ${S.date.trim()}` : "No publication date",
    ...(S.recDate.trim() ? [`Recorded ${S.recDate.trim()}`] : []),
    ...(S.recAt.trim() ? [`Recorded at ${S.recAt.trim()}`] : []),
    ...(S.recTypes.length
      ? [
          S.recTypes
            .map(recTypeName)
            .join(", ")
            .replace(/^./, (c) => c.toUpperCase()),
        ]
      : []),
    on ? plural(on, "option") + " on" : "No options on",
  ];
}

/** The rail's steps, in page order. */
export function railSteps(p: ProgressInput): Step[] {
  const { state, plan, unreviewed, hasTracklist, notAlbum, running } = p;
  const noun = releaseNoun(state.album);
  const S = state.settings;
  const trackCount = plan.tracks.reduce((n, rows) => n + rows.length, 0);
  const discCount = plan.tracks.filter((rows) => rows.length).length;
  const perf = linkedPerformers(state, plan);
  const album = albumSummary(state);
  const langName = labelLangName(S);
  // Until a starting point is picked, the later steps are locked.
  const locked = !state.start;
  const status = (attention: boolean, done: boolean): StepStatus =>
    locked ? "pending" : attention ? "attention" : done ? "done" : "pending";

  const steps: Omit<Step, "locked">[] = [
    state.start
      ? { id: "start", name: "Source", summary: START_NAMES[state.start], status: "done" }
      : { id: "start", name: "Start", summary: "Pick a starting point", status: "pending" },
    {
      id: "album",
      name: capitalized(noun),
      summary: album ?? "Not set",
      status: album
        ? status(blockedAt(plan, "album") || hasTracklist || notAlbum, true)
        : "pending",
    },
    {
      id: "settings",
      name: "Item settings",
      summary: S.date.trim()
        ? `${langName || "No label language"} · ${S.date.trim()}`
        : langName
          ? `${langName} labels`
          : "No label language",
      status: status(blockedAt(plan, "settings"), true),
    },
    {
      id: "tracks",
      name: "Tracks",
      summary: trackCount
        ? [
            plural(discCount, "disc"),
            plural(trackCount, "track"),
            ...(unreviewed ? [`${unreviewed} to review`] : []),
          ].join(" · ")
        : "No tracks yet",
      status: trackCount ? status(blockedAt(plan, "tracks") || unreviewed > 0, true) : "pending",
    },
    {
      id: "performers",
      name: "People",
      summary: perf.total
        ? `${perf.linked} of ${plural(perf.total, "performer")} linked`
        : "From the tracklist",
      status: perf.total ? status(perf.linked < perf.total, true) : "pending",
    },
    {
      id: "create",
      name: "Create on Wikidata",
      summary: running
        ? running.total
          ? `Running · ${running.done} of ${running.total}`
          : "Running"
        : !trackCount
          ? "Nothing to create yet"
          : plan.ready && !unreviewed && !hasTracklist && !notAlbum
            ? `Ready · ${plural(plan.ops.length, "edit")}`
            : `Blocked: ${createBlockedBy(p, perf)}`,
      status: "pending",
    },
  ];
  return steps.map((s) => ({ ...s, locked: locked && s.id !== "start" }));
}

/** The first thing holding up the run, in a few words. */
function createBlockedBy(p: ProgressInput, perf: { linked: number; total: number }): string {
  if (!p.state.start) return "pick a starting point";
  const noun = releaseNoun(p.state.album);
  if (p.notAlbum) return `${noun} QID`;
  if (p.hasTracklist) return `${noun} has a tracklist`;
  if (blockedAt(p.plan, "album")) return `${noun} details`;
  if (perf.linked < perf.total) return plural(perf.total - perf.linked, "performer");
  if (p.unreviewed) return plural(p.unreviewed, "match", "matches");
  if (blockedAt(p.plan, "settings")) return "item settings";
  if (blockedAt(p.plan, "tracks")) return "tracks";
  return "errors";
}

export interface CreateCount {
  kind: "tracks" | "compositions" | "album";
  label: string;
  /** The colour token for its swatch. */
  edge: string;
  count: number;
  /** Existing items the run reuses instead, if any. */
  reused: number;
}

/**
 * How many items of each kind the run creates. From the plan's edits once it has
 * them, otherwise from the form, so the counts still show while something blocks the run.
 */
export function createCounts(state: State, plan: Plan): CreateCount[] {
  const rows = plan.tracks.flatMap((ts, di) => ts.map((t) => ({ t, d: state.discs[di] })));
  const has = (v: string | undefined) => QID.test((v ?? "").trim());
  const creates = (prefix: string) =>
    plan.ops.filter((o) => o.op === "create" && o.key.startsWith(prefix)).length;
  const fromOps = plan.ops.length > 0;
  const tracks = fromOps ? creates("track:") : rows.filter(({ t, d }) => !has(d.track[t.n])).length;
  const comps = fromOps ? creates("comp:") : rows.filter(({ t, d }) => !has(d.comp[t.n])).length;
  return [
    {
      kind: "tracks",
      label: "Tracks",
      edge: "trk-edge",
      count: tracks,
      reused: rows.length - tracks,
    },
    {
      kind: "compositions",
      label: "Compositions",
      edge: "cmp-edge",
      count: comps,
      reused: rows.length - comps,
    },
    {
      kind: "album",
      label:
        state.album.mode === "create"
          ? capitalized(newNoun(state))
          : `${capitalized(releaseNoun(state.album))} tracklist`,
      edge: "disc-edge",
      count: rows.length ? 1 : 0,
      reused: 0,
    },
  ];
}

export interface Check {
  ok: boolean;
  text: string;
  /** The section that fixes it, while it isn't ok. */
  at: StepId | "matches" | null;
  /** Something's wrong, not just still to do, so it's marked for attention. */
  problem?: boolean;
}

/** The input `runChecks` needs on top of the rail's. */
export type CheckInput = ProgressInput & {
  /** Why the logged-in account can't edit yet, if it can't. */
  ineligible: string | null;
  matchesPending: boolean;
  /** The existing album is still being looked up on Wikidata. */
  albumPending: boolean;
};

type CheckAt = Check["at"];
const done = (text: string): Check => ({ ok: true, text, at: null });
/** Still to do, but nothing's wrong. */
const todo = (text: string, at: CheckAt): Check => ({ ok: false, text, at });
/** Something's wrong that holds the run up. */
const problem = (text: string, at: CheckAt): Check => ({ ok: false, text, at, problem: true });

/** The run's checklist: each thing that has to be true before it can start. */
export function runChecks(p: CheckInput): Check[] {
  const { state, plan } = p;
  const trackCount = plan.tracks.reduce((n, rows) => n + rows.length, 0);
  return [
    // Logged out, the form can't be used at all, so a login isn't on the list.
    ...(p.ineligible ? [problem(p.ineligible, null)] : []),
    releaseCheck(p),
    tracksCheck(plan, trackCount),
    performersCheck(p, trackCount),
    ...(trackCount ? [matchesCheck(p)] : []),
    // Item settings stay locked, so they can't be fixed, until a starting point is picked.
    ...(state.start && blockedAt(plan, "settings")
      ? [problem("Fix the errors in Item settings", "settings")]
      : []),
    ...(blockedAt(plan, "create")
      ? [problem("Fix the problems under Create on Wikidata", "create")]
      : []),
  ];
}

/** The album or single: picked or filled in, and with no tracklist yet. */
function releaseCheck(p: CheckInput): Check {
  const { state, plan } = p;
  const noun = releaseNoun(state.album);
  if (!state.start) return todo("Pick a starting point", "start");
  const wrong = blockedAt(plan, "album") || p.notAlbum;
  if (wrong) return problem(`Choose or create the ${noun}`, "album");
  if (albumSummary(state) === null) return todo(`Choose or create the ${noun}`, "album");
  if (p.hasTracklist) return problem(`${capitalized(noun)} already has a tracklist`, "album");
  if (state.album.mode === "create") return done(`New ${noun} filled in`);
  if (p.albumPending) return todo("Checking the QID on Wikidata…", "album");
  return done(`${capitalized(noun)} has no tracklist yet`);
}

function tracksCheck(plan: Plan, trackCount: number): Check {
  if (!trackCount) return todo("Add at least one track", "tracks");
  if (blockedAt(plan, "tracks")) return problem("Fix the errors in Tracks", "tracks");
  return done(plural(trackCount, "track"));
}

function performersCheck(p: CheckInput, trackCount: number): Check {
  const { linked, total } = linkedPerformers(p.state, p.plan);
  const blocked = blockedAt(p.plan, "performers");
  if (linked < total) {
    const text = `Link ${plural(total - linked, "more performer")}`;
    // Once there are tracks, an unlinked performer holds the run up.
    return trackCount > 0 || blocked ? problem(text, "performers") : todo(text, "performers");
  }
  if (blocked) return problem("Fix the QIDs under People", "performers");
  if (!total) return todo("Link every performer", "performers");
  return done("Every performer has a QID");
}

function matchesCheck(p: CheckInput): Check {
  if (p.unreviewed)
    return problem(
      `Review ${plural(p.unreviewed, "possible match", "possible matches")}`,
      "matches",
    );
  if (p.matchesPending) return todo("Looking for possible matches…", "matches");
  return done("All possible matches reviewed");
}
