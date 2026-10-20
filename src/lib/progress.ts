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
  REC_TYPES,
  type Settings,
  type StartingPoint,
  type State,
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
  /** An existing single's QID can't be used: it doesn't exist, redirects, or isn't a single. */
  notSingle: boolean;
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

/**
 * The composers and lyricists the compositions get, by name, with how many songs each
 * wrote: those of every imported track, with the setting on, unless the row reuses a
 * composition and Link reused items is off.
 */
export function writers(
  state: State,
  plan: Plan,
): Map<string, { composer: boolean; lyricist: boolean; songs: number }> {
  const out = new Map<string, { composer: boolean; lyricist: boolean; songs: number }>();
  if (!state.settings.mbWriters) return out;
  plan.tracks.forEach((rows, di) => {
    for (const t of rows) {
      if (!t.mb) continue;
      if ((state.discs[di]?.comp[t.n] ?? "").trim() && !state.settings.extendExisting) continue;
      const names = new Set<string>();
      for (const [role, ws] of [
        ["composer", t.mb.composers],
        ["lyricist", t.mb.lyricists],
      ] as const)
        for (const w of ws) {
          const row = out.get(w.name) ?? { composer: false, lyricist: false, songs: 0 };
          row[role] = true;
          out.set(w.name, row);
          names.add(w.name);
        }
      for (const name of names) out.get(name)!.songs++;
    }
  });
  return out;
}

export interface PerformerRow {
  name: string;
  /** How many tracks list them. */
  tracks: number;
  /** One of the album artists, as entered for a new album or imported from MusicBrainz. */
  albumArtist: boolean;
  /** Whether they're a performer, whom the run needs a QID for. */
  performer: boolean;
  /** Composer or lyricist of some composition, and of how many songs. */
  composer: boolean;
  lyricist: boolean;
  songs: number;
}

/** Each name in People, in the table's order, with where it's used: performers, then writers. */
export function performerRows(state: State, plan: Plan): PerformerRow[] {
  const ofAlbum =
    state.album.mode === "create" || state.start === "mb" ? new Set(albumArtists(state)) : null;
  const tracks = plan.tracks.flat();
  const performers = new Set(performerNames(state, plan));
  const wrote = writers(state, plan);
  return [...new Set([...performers, ...wrote.keys()])].map((name) => ({
    name,
    tracks: tracks.filter((t) => t.artists.includes(name)).length,
    albumArtist: ofAlbum?.has(name) ?? false,
    performer: performers.has(name),
    composer: wrote.get(name)?.composer ?? false,
    lyricist: wrote.get(name)?.lyricist ?? false,
    songs: wrote.get(name)?.songs ?? 0,
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
  return title ? `New · ${title}` : "New album";
}

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
    new: "New album from scratch",
  }[start];
  const title =
    A.mode === "existing" ? (albumLabel ?? A.qid.trim()) || "No album picked" : A.title.trim();
  return {
    from,
    title: title || "Untitled album",
    details: [
      ...(artists.length ? [artists.join(", ")] : []),
      ...(trackCount ? [plural(discCount, "disc"), plural(trackCount, "track")] : []),
      ...(start === "mb" && A.mode === "create"
        ? ["not on Wikidata yet, so a new album will be created"]
        : []),
    ],
  };
}

/** The label language's name, or its code when it isn't a listed one. */
const labelLangName = (S: Settings) =>
  LABEL_LANGS.find(([c]) => c === S.lang.trim())?.[1] ?? S.lang.trim();

/** The options Item settings lists as checkboxes. */
export const SETTING_FLAGS = [
  "compPerformer",
  "extendExisting",
  "straight",
  "mbWriters",
  "mbDetails",
] as const;

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
    ...(S.recTypes.length
      ? [S.recTypes.map((q) => REC_TYPES.find(([r]) => r === q)?.[1] ?? q).join(", ")]
      : []),
    on ? plural(on, "option") + " on" : "No options on",
  ];
}

/** The rail's steps, in page order. */
export function railSteps(p: ProgressInput): Step[] {
  const { state, plan, unreviewed, hasTracklist, notAlbum, notSingle, running } = p;
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
      name: "Album",
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
      status: trackCount
        ? status(blockedAt(plan, "tracks") || notSingle || unreviewed > 0, true)
        : "pending",
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
          : plan.ready && !unreviewed && !hasTracklist && !notAlbum && !notSingle
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
  if (p.notAlbum) return "album QID";
  if (p.hasTracklist) return "album has a tracklist";
  if (blockedAt(p.plan, "album")) return "album details";
  if (perf.linked < perf.total) return plural(perf.total - perf.linked, "performer");
  if (p.unreviewed) return plural(p.unreviewed, "match", "matches");
  if (blockedAt(p.plan, "settings")) return "item settings";
  if (blockedAt(p.plan, "tracks") || p.notSingle) return "tracks";
  return "errors";
}

export interface CreateCount {
  kind: "tracks" | "compositions" | "album" | "singles";
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
  const comps = fromOps
    ? creates("comp:")
    : rows.filter(({ t, d }) => !has(d.comp[t.n]) && !has(d.track[t.n])).length;
  const singles = rows.filter(({ t, d }) => d.single[t.n]);
  const newSingles = fromOps
    ? creates("single:")
    : singles.filter(({ t, d }) => !has(d.single[t.n]?.qid)).length;
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
      label: state.album.mode === "create" ? "Album" : "Album tracklist",
      edge: "disc-edge",
      count: rows.length ? 1 : 0,
      reused: 0,
    },
    {
      kind: "singles",
      label: "Singles",
      edge: "rg-edge",
      count: newSingles,
      reused: singles.length - newSingles,
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

/** The run's checklist: each thing that has to be true before it can start. */
export function runChecks(
  p: ProgressInput & {
    /** Why the logged-in account can't edit yet, if it can't. */
    ineligible: string | null;
    matchesPending: boolean;
    /** The existing album is still being looked up on Wikidata. */
    albumPending: boolean;
  },
): Check[] {
  const { state, plan, unreviewed, hasTracklist } = p;
  const trackCount = plan.tracks.reduce((n, rows) => n + rows.length, 0);
  const perf = linkedPerformers(state, plan);
  const albumWrong = blockedAt(plan, "album") || p.notAlbum;
  const albumBlocked = albumWrong || albumSummary(state) === null;
  const checks: Check[] = [
    // Logged out, the form can't be used at all, so a login isn't on the list.
    ...(p.ineligible ? [{ ok: false, text: p.ineligible, at: null, problem: true }] : []),
    !state.start
      ? { ok: false, text: "Pick a starting point", at: "start" }
      : albumBlocked
        ? { ok: false, text: "Choose or create the album", at: "album", problem: albumWrong }
        : hasTracklist
          ? { ok: false, text: "Album already has a tracklist", at: "album", problem: true }
          : state.album.mode === "existing" && p.albumPending
            ? { ok: false, text: "Checking the album on Wikidata…", at: "album" }
            : {
                ok: true,
                text:
                  state.album.mode === "create"
                    ? "New album filled in"
                    : "Album has no tracklist yet",
                at: null,
              },
    trackCount
      ? blockedAt(plan, "tracks") || p.notSingle
        ? { ok: false, text: "Fix the errors in Tracks", at: "tracks", problem: true }
        : { ok: true, text: plural(trackCount, "track"), at: null }
      : { ok: false, text: "Add at least one track", at: "tracks" },
    perf.linked < perf.total || blockedAt(plan, "performers")
      ? {
          ok: false,
          text:
            perf.linked < perf.total
              ? `Link ${plural(perf.total - perf.linked, "more performer")}`
              : "Fix the QIDs under People",
          at: "performers",
          // Once there are tracks, an unlinked performer holds the run up.
          problem: trackCount > 0 || blockedAt(plan, "performers"),
        }
      : {
          ok: !!perf.total,
          text: perf.total ? "Every performer has a QID" : "Link every performer",
          at: perf.total ? null : "performers",
        },
  ];
  if (trackCount)
    checks.push(
      unreviewed
        ? {
            ok: false,
            text: `Review ${plural(unreviewed, "possible match", "possible matches")}`,
            at: "matches",
            problem: true,
          }
        : p.matchesPending
          ? { ok: false, text: "Looking for possible matches…", at: "matches" }
          : { ok: true, text: "All possible matches reviewed", at: null },
    );
  // Item settings stay locked, so they can't be fixed, until a starting point is picked.
  if (state.start && blockedAt(plan, "settings"))
    checks.push({
      ok: false,
      text: "Fix the errors in Item settings",
      at: "settings",
      problem: true,
    });
  if (blockedAt(plan, "create"))
    checks.push({
      ok: false,
      text: "Fix the problems under Create on Wikidata",
      at: "create",
      problem: true,
    });
  return checks;
}
