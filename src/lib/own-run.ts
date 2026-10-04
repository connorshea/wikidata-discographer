// The run started from the form (src/components/RunSection.tsx), kept in
// localStorage until it ends and its QIDs are written back, so leaving the
// page or reloading during a run doesn't lose them. `form` is the form's id
// when the run started (see `useFormId` in App.tsx): its QIDs only go back
// into that form, not one cleared or loaded with another release since.
import type { EditLogEntry, SubmissionInfo } from "./api-types.ts";
import { FetchError } from "./client.ts";
import type { State } from "./plan.ts";

export const OWN_RUN_KEY = "discographer:ownRun";

export interface OwnRun {
  run: number;
  form: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The saved own run, or null if there's none or it isn't one. */
export function parseOwnRun(raw: string | null): OwnRun | null {
  try {
    const o: unknown = JSON.parse(raw ?? "null");
    if (typeof o !== "object" || o === null) return null;
    const { run, form } = o as Partial<OwnRun>;
    return Number.isInteger(run) && run! > 0 && typeof form === "string"
      ? { run: run!, form }
      : null;
  } catch {
    return null;
  }
}

/**
 * The run this tab follows once another tab saves its own run (`saved`), or
 * starts following none. A run this tab still follows is kept until it ends.
 */
export function adoptOwnRun(current: OwnRun | null, saved: string | null): OwnRun | null {
  return parseOwnRun(saved) ?? current;
}

export function loadOwnRun(store: Store = localStorage): OwnRun | null {
  try {
    return parseOwnRun(store.getItem(OWN_RUN_KEY));
  } catch {
    return null;
  }
}

export function saveOwnRun(o: OwnRun | null, store: Store = localStorage): void {
  try {
    if (o === null) store.removeItem(OWN_RUN_KEY);
    else store.setItem(OWN_RUN_KEY, JSON.stringify(o));
  } catch {
    // storage blocked: the run is only followed while the form stays open
  }
}

/** The run to show first: the album list's `?run=<id>`, else the own run. */
export function initialRunId(search: string, own: OwnRun | null): number | null {
  const id = Number(new URLSearchParams(search).get("run"));
  return Number.isInteger(id) && id > 0 ? id : (own?.run ?? null);
}

/**
 * What an answer about a run means for the own run: "keep" following it (it's
 * still running, or another run), "drop" it (it ended, but the form has been
 * replaced since), or "apply" its QIDs to the form and drop it.
 */
export function settleOwnRun(
  r: Pick<SubmissionInfo, "id" | "status">,
  own: OwnRun | null,
  formId: string,
): "keep" | "drop" | "apply" {
  if (r.status === "running" || r.id !== own?.run) return "keep";
  return own.form === formId ? "apply" : "drop";
}

/** Whether a run lookup failed for good: a missing run (or someone else's) won't turn up. */
export const isGone = (e: unknown) => e instanceof FetchError && e.status === 404;

type Created = Pick<EditLogEntry, "op" | "ok" | "key" | "qid">;

const isCreated = (e: Created) => e.op === "create" && e.ok && !!e.key && !!e.qid;

/** Whether a run created anything to write back. */
export const createdAny = (edits: readonly Created[]) => edits.some(isCreated);

/**
 * Write the QIDs a run created back into the form, by plan key, so a rerun
 * reuses them instead of duplicating.
 */
export function applyCreated(s: State, edits: readonly Created[]): void {
  for (const { key, qid } of edits.filter(isCreated)) {
    const [kind, di, n] = key!.split(":");
    const disc = s.discs[Number(di)];
    if (kind === "album") {
      s.album.mode = "existing";
      s.album.qid = qid!;
    } else if (!disc) continue;
    else if (kind === "comp") disc.comp[n] = qid!;
    else if (kind === "track") disc.track[n] = qid!;
    else if (kind === "single") disc.single[n] = { date: "", qid: qid! };
  }
}
