// Before a run starts, check that every item it points at exists (issue #17).
// The plan only checks that QIDs look like QIDs, so a typo would otherwise
// fail the run partway, after earlier items were already created.
//
// Wikidata is asked as lightly as possible: unique QIDs only, page info only,
// 50 per request, one request at a time (server/wikidata-client.ts), and QIDs
// found to exist are remembered for a while, so starting again after fixing
// one typo doesn't fetch the rest again.
//
// The existing album must also be an album or EP: an instance of one of the
// album or EP classes the app knows.
import { checkItems, getStatementItems, type ItemCheck } from "./wikidata-client.ts";
import { CLASS_KINDS } from "../src/lib/music.ts";
import { ALBUM_FORMS, type Op, type State, type Value } from "../src/lib/plan.ts";
import { PROPERTY_LABELS } from "../src/lib/preview.ts";

/** Every existing item the plan edits or links to, with what it's used for. */
export function planQids(ops: readonly Op[]): Map<string, string> {
  const out = new Map<string, string>();
  const add = (qid: string, use: string) => {
    if (!out.has(qid)) out.set(qid, use);
  };
  const value = (property: string, v: Value) => {
    // `{ ref }` values are items the run creates.
    if (v.type === "item" && "id" in v) add(v.id, `${PROPERTY_LABELS[property] ?? property} value`);
    if (v.type === "quantity" && v.unit) add(v.unit, "unit");
  };
  for (const op of ops) {
    if (op.op === "addClaims" && "id" in op.target) add(op.target.id, `the ${op.what}`);
    for (const c of op.claims) {
      value(c.property, c.value);
      for (const q of c.qualifiers ?? []) value(q.property, q.value);
    }
  }
  return out;
}

/** Where in the form each QID was entered, e.g. `Performer “X”`. */
function formSources(state: State): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (qid: string | undefined, where: string) => {
    const q = qid?.trim();
    if (!q) return;
    const list = out.get(q);
    if (list) {
      if (!list.includes(where)) list.push(where);
    } else out.set(q, [where]);
  };
  if (state.album.mode === "existing") add(state.album.qid, "The existing album");
  else {
    add(state.album.type, "The album type");
    add(state.album.form, "The album form");
  }
  add(state.settings.p407, "The language of work");
  add(state.settings.trackType, "The track type");
  for (const [name, qid] of Object.entries(state.artists)) add(qid, `Performer “${name}”`);
  state.discs.forEach((d, i) => {
    const disc = `Disc ${i + 1}`;
    add(d.part, `${disc} part`);
    for (const [n, qid] of Object.entries(d.comp)) add(qid, `${disc} track ${n} composition`);
    for (const [n, qid] of Object.entries(d.track)) add(qid, `${disc} track ${n} track`);
    for (const [n, s] of Object.entries(d.single)) add(s.qid, `${disc} track ${n} single`);
  });
  return out;
}

const OK_TTL_MS = 10 * 60_000;
const MAX_REMEMBERED = 20_000;
/** QIDs found to exist, with when. Only "ok" is remembered: a fix must be seen. */
const knownOk = new Map<string, number>();

/** Forget the remembered QIDs (for tests). */
export function forgetCheckedQids(): void {
  knownOk.clear();
}

async function check(qids: string[]): Promise<Map<string, ItemCheck>> {
  const now = Date.now();
  const todo = qids.filter((q) => {
    const at = knownOk.get(q);
    return at === undefined || now - at > OK_TTL_MS;
  });
  // The user is waiting, so retry a transient failure once, not three times.
  const found = await checkItems(todo, { retries: 1 });
  for (const [q, r] of found) {
    if (r.status !== "ok") continue;
    knownOk.delete(q);
    knownOk.set(q, now);
  }
  // A Map keeps insertion order, so the oldest go first.
  for (const q of knownOk.keys()) {
    if (knownOk.size <= MAX_REMEMBERED) break;
    knownOk.delete(q);
  }
  return new Map(qids.map((q) => [q, found.get(q) ?? { status: "ok" }]));
}

const MAX_PROBLEMS = 10;

/**
 * Problems with the items the plan points at, one sentence each, naming
 * where in the form each bad QID came from. Empty when every item exists.
 * Throws if Wikidata can't be asked.
 */
export async function checkPlanQids(ops: readonly Op[], state: State): Promise<string[]> {
  const used = planQids(ops);
  const sources = formSources(state);
  const results = await check([...used.keys()]);
  const problems: string[] = [];
  for (const [qid, r] of results) {
    if (r.status === "ok") continue;
    const where = sources.get(qid)?.join(", ") ?? `The ${used.get(qid)}`;
    problems.push(
      r.status === "missing"
        ? `${where}: ${qid} doesn't exist.`
        : `${where}: ${qid} redirects to ${r.to}; use ${r.to} instead.`,
    );
  }
  const album = state.album.mode === "existing" ? state.album.qid.trim() : null;
  if (album && results.get(album)?.status === "ok") {
    const problem = await checkAlbumKind(album);
    if (problem) problems.unshift(problem);
  }
  if (problems.length > MAX_PROBLEMS)
    return [
      ...problems.slice(0, MAX_PROBLEMS),
      `…and ${problems.length - MAX_PROBLEMS} more QIDs that don't exist or redirect.`,
    ];
  return problems;
}

/** The album and EP classes the app knows. Exact QIDs, no subclasses. */
const ALBUM_CLASSES: ReadonlySet<string> = new Set([
  ...CLASS_KINDS.filter(([, kind]) => kind === "album" || kind === "ep").map(([q]) => q),
  ...ALBUM_FORMS.map(([q]) => q),
]);

/**
 * Why the existing album isn't an album or EP, or null if it is. Only that
 * item's “instance of” statements are fetched.
 */
async function checkAlbumKind(qid: string): Promise<string | null> {
  const classes = await getStatementItems(qid, "P31", { retries: 1 });
  if (classes.some((c) => ALBUM_CLASSES.has(c))) return null;
  if (classes.length === 0)
    return `The existing album: ${qid} has no “instance of” statement, so it can't be checked to be an album or EP.`;
  return `The existing album: ${qid} is an instance of ${classes.join(", ")}, not an album or EP. Check the QID.`;
}
