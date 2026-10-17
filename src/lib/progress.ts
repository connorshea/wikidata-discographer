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
export const SETTING_FLAGS = ["compPerformer", "extendExisting", "straight", "mbIds"] as const;

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
    on ? plural(on, "option") + " on" : "No options on",
  ];
}

/** The rail's steps, in page order. */
export function railSteps(p: ProgressInput): Step[] {
  const { state, plan, unreviewed, hasTracklist, notAlbum, running } = p;
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

  const steps: Step[] = [
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
      status: trackCount ? status(blockedAt(plan, "tracks") || unreviewed > 0, true) : "pending",
    },
    {
      id: "performers",
      name: "Performers",
      summary: perf.total ? `${perf.linked} of ${perf.total} linked` : "From the tracklist",
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
  return steps;
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
  if (blockedAt(p.plan, "tracks")) return "tracks";
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
  /** Fixed by logging in, so it links to the login. */
  login?: boolean;
}

/** The run's checklist: each thing that has to be true before it can start. */
export function runChecks(
  p: ProgressInput & {
    loggedIn: boolean;
    ineligible: string | null;
    matchesPending: boolean;
    /** The existing album is still being looked up on Wikidata. */
    albumPending: boolean;
  },
): Check[] {
  const { state, plan, unreviewed, hasTracklist } = p;
  const trackCount = plan.tracks.reduce((n, rows) => n + rows.length, 0);
  const perf = linkedPerformers(state, plan);
  const albumBlocked = blockedAt(plan, "album") || p.notAlbum || albumSummary(state) === null;
  const checks: Check[] = [
    p.loggedIn
      ? p.ineligible
        ? { ok: false, text: p.ineligible, at: null }
        : { ok: true, text: "Logged in and eligible to edit", at: null }
      : { ok: false, text: "Log in with your Wikimedia account", at: null, login: true },
    !state.start
      ? { ok: false, text: "Pick a starting point", at: "start" }
      : albumBlocked
        ? { ok: false, text: "Choose or create the album", at: "album" }
        : hasTracklist
          ? { ok: false, text: "Album already has a tracklist", at: "album" }
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
      ? blockedAt(plan, "tracks")
        ? { ok: false, text: "Fix the errors in Tracks", at: "tracks" }
        : { ok: true, text: plural(trackCount, "track"), at: null }
      : { ok: false, text: "Add at least one track", at: "tracks" },
    perf.linked < perf.total || blockedAt(plan, "performers")
      ? {
          ok: false,
          text:
            perf.linked < perf.total
              ? `Link ${plural(perf.total - perf.linked, "more performer")}`
              : "Fix the performer QIDs",
          at: "performers",
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
          }
        : p.matchesPending
          ? { ok: false, text: "Looking for possible matches…", at: "matches" }
          : { ok: true, text: "All possible matches reviewed", at: null },
    );
  // Item settings stay locked, so they can't be fixed, until a starting point is picked.
  if (state.start && blockedAt(plan, "settings"))
    checks.push({ ok: false, text: "Fix the errors in Item settings", at: "settings" });
  if (blockedAt(plan, "create"))
    checks.push({ ok: false, text: "Fix the problems under Create on Wikidata", at: "create" });
  return checks;
}
