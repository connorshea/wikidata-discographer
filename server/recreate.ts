// A run started again from another browser or device doesn't get the last
// run's QIDs written back into its form (src/lib/own-run.ts), so it would
// create every item again. Its creates are checked against the user's last
// run before it starts (server/submissions.ts).
import { buildPlan, describeOp, normalizeQid, type Op, type State } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";

type CreateOp = Extract<Op, { op: "create" }>;

export interface LastRun {
  /** The form it was started from. */
  input: unknown;
  /** The album it created or added to, if known. */
  albumQid: string | null;
  /** Its creates that went through, by plan key. */
  created: readonly { key: string; qid: string }[];
}

export interface Recreated {
  key: string;
  qid: string;
  what: string;
}

/** Labels as a string to compare by, whatever their key order. */
const labelKey = (labels: Record<string, string>) =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1)));

const creates = (ops: readonly Op[]) =>
  new Map(ops.filter((o): o is CreateOp => o.op === "create").map((o) => [o.key, o]));

/**
 * The items `ops` would create that `last` already created: the same plan key,
 * with the same labels, for the same album. A plan key alone isn't enough,
 * since "comp:0:1" is another song in another album.
 */
export function recreatedItems(ops: readonly Op[], state: State, last: LastRun): Recreated[] {
  const lastInput = coerceState(last.input);
  const lastOps = creates(buildPlan(lastInput).ops);
  const next = creates(ops);
  const sameAlbum =
    state.album.mode === "existing"
      ? last.albumQid !== null && normalizeQid(state.album.qid.trim()) === last.albumQid
      : lastInput.album.mode === "create" &&
        !!next.get("album") &&
        labelKey(next.get("album")!.labels) === labelKey(lastOps.get("album")?.labels ?? {});
  if (!sameAlbum) return [];
  return last.created.flatMap(({ key, qid }) => {
    const op = next.get(key);
    const before = lastOps.get(key);
    return op && before && labelKey(op.labels) === labelKey(before.labels)
      ? [{ key, qid, what: describeOp(op) }]
      : [];
  });
}

/**
 * Whether `ops` would create again the item that a run ended "unknown" over,
 * once it has been found as `found`. A run of another album, or one that uses
 * the item (or what it was merged into), doesn't.
 */
export function recreatesFound(
  ops: readonly Op[],
  state: State,
  last: Omit<LastRun, "created">,
  found: { key: string; qid: string },
): boolean {
  return recreatedItems(ops, state, { ...last, created: [found] }).length > 0;
}
