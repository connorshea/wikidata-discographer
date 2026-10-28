// What Create on Wikidata shows about a run: how its edits split by item type,
// before it starts and as it goes, and roughly how long the rest will take.
import type { EditLogEntry, SubmissionInfo } from "./api-types.ts";
import { buildPlan, type Plan, type State } from "./plan.ts";
import { type PreviewEdit, type PreviewKind, previewPlan } from "./preview.ts";

/** The plan's edits in run order, each with its item's kind, title and row. */
export function runEdits(
  plan: Pick<Plan, "ops" | "tracks">,
  state: State,
  existingSingle = false,
): PreviewEdit[] {
  return previewPlan(plan, state, existingSingle)
    .flatMap((g) => g.edits)
    .toSorted((a, b) => a.n - b.n);
}

export const KIND_EDGES: Readonly<Record<PreviewKind, string>> = {
  comp: "cmp-edge",
  track: "trk-edge",
  album: "disc-edge",
  single: "rg-edge",
};

/** Item types in the order the run makes them, as the bar and legends list them. */
const ORDER: readonly PreviewKind[] = ["comp", "track", "album", "single"];

export interface EditShare {
  kind: PreviewKind;
  edge: string;
  /** Edits of this kind, for the width of its part of the bar. */
  edits: number;
  /** The number to put first in bold, then the rest of the legend, e.g. 23 + "new compositions". */
  count: number;
  text: string;
  /** e.g. "1 reused", after a separator. */
  extra: string | null;
}

/** How the run's edits split by item type, for the bar above the run button. */
export function editShares(edits: readonly PreviewEdit[], albumName: string): EditShare[] {
  return ORDER.flatMap((kind): EditShare[] => {
    const mine = edits.filter((e) => e.kind === kind);
    if (!mine.length) return [];
    const made = mine.filter((e) => e.creates).length;
    const reused = mine.length - made;
    const edge = KIND_EDGES[kind];
    if (kind === "album")
      return [
        {
          kind,
          edge,
          edits: mine.length,
          count: 1,
          text: made
            ? `new ${mine[0].noun === "single" ? "single" : "album"} with its tracklist`
            : `tracklist added to ${albumName}`,
          extra: null,
        },
      ];
    const name = { comp: "composition", track: "track", single: "single" }[kind];
    return [
      {
        kind,
        edge,
        edits: mine.length,
        count: made,
        text: `new ${made === 1 ? name : `${name}s`}`,
        extra: reused ? `${reused} reused` : null,
      },
    ];
  });
}

/** What the per-type progress calls each kind. */
const PROGRESS_LABELS: Readonly<Record<PreviewKind, string>> = {
  comp: "Compositions",
  track: "Tracks",
  album: "Album tracklist",
  single: "Singles",
};

export interface RunProgressInfo {
  /** The run's edits in order, when the plan rebuilt from its form matches the server's. */
  edits: PreviewEdit[] | null;
  /** Per item type: edits made so far of the kind's total. */
  kinds: { kind: PreviewKind; edge: string; label: string; done: number; total: number }[];
  /** The edit being made now, while the run goes. */
  next: PreviewEdit | null;
  /** Roughly how long the edits left take. */
  secondsLeft: number;
}

// The server waits 3 s before a create and 2 s before other edits
// (server/edit-pace.ts), and Wikidata takes a moment to answer each.
const CREATE_SECONDS = 4;
const EDIT_SECONDS = 3;

/**
 * The edits a run makes, from the plan built from its form, or null if that
 * plan isn't the one the server is running. A run's form never changes, so
 * this needs building once per run, not on every poll.
 */
export function plannedEdits(run: Pick<SubmissionInfo, "input" | "total">): PreviewEdit[] | null {
  const plan = buildPlan(run.input);
  return plan.ops.length === run.total ? runEdits(plan, run.input) : null;
}

/**
 * A run's progress by item type. The server's total is the plan built from the
 * run's form (server/submissions.ts), and its log has one entry per operation
 * in order, so the same plan built here says what each entry was and what's next.
 */
export function runProgress(
  run: SubmissionInfo,
  edits: PreviewEdit[] | null = plannedEdits(run),
): RunProgressInfo {
  const done = run.edits.length;
  const kinds = edits
    ? ORDER.flatMap((kind) => {
        const all = edits.filter((e) => e.kind === kind);
        if (!all.length) return [];
        const release = all[0].noun === "single" ? "Single" : "Album";
        const label =
          kind !== "album"
            ? PROGRESS_LABELS[kind]
            : all.some((e) => e.creates)
              ? release
              : `${release} tracklist`;
        const made = all.filter((e) => e.n <= done).length;
        return [{ kind, edge: KIND_EDGES[kind], label, done: made, total: all.length }];
      })
    : [];
  const left = edits ? edits.slice(done) : [];
  return {
    edits,
    kinds,
    next: run.status === "running" ? (edits?.[done] ?? null) : null,
    secondsLeft: edits ? runSeconds(left) : Math.max(run.total - done, 0) * EDIT_SECONDS,
  };
}

/** Roughly how long making these edits takes. */
export function runSeconds(edits: readonly PreviewEdit[]): number {
  return edits.reduce((s, e) => s + (e.creates ? CREATE_SECONDS : EDIT_SECONDS), 0);
}

/** "about a minute", rounded so it doesn't jump about between polls. */
export function roughly(seconds: number): string {
  if (seconds < 45) return "less than a minute";
  if (seconds < 90) return "about a minute";
  return `about ${Math.round(seconds / 60)} minutes`;
}

/** "About a minute left." */
export function timeLeft(seconds: number): string {
  if (seconds <= 0) return "Finishing up.";
  const text = roughly(seconds);
  return `${text[0].toUpperCase()}${text.slice(1)} left.`;
}

/** A log entry's kind from what the server logged, for runs whose plan can't be rebuilt. */
export function entryKind(e: EditLogEntry): PreviewKind {
  // A new single is the release itself, not one of the singles old runs made per track.
  if (e.key === "album") return "album";
  if (e.kind === "work") return "comp";
  if (e.kind === "track" || e.kind === "single") return e.kind;
  return "album";
}

/** The run's start in the viewer's time, with the date unless it's today. */
export function startedAt(createdAt: string, now = new Date()): string {
  const d = new Date(`${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return createdAt;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} · ${time}`;
}
