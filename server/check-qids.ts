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
// album or EP classes the app knows. And it mustn't have a tracklist yet, or
// the run would add a second one beside it.
//
// An existing single must be an instance of single (Q134556), or the run would
// give a song or an album a tracklist as if it were the track's single.
//
// A reused track mustn't record a different composition than the one the run
// links it to, or it would end up with two (P2550). When what it records is
// a single, album or EP rather than a composition, the track itself needs
// fixing on Wikidata, so the problem says that instead.
//
// A new item mustn't have the same label and description as an item the form
// reuses, as another new item, or as any item in the local mirror with them,
// or Wikidata would refuse to create it. This is only checked once nothing
// else is wrong, and the reused tracks' labels and descriptions come from when
// their compositions were checked.
import {
  checkItems,
  getEntities,
  getStatementItems,
  getTerms,
  type ItemCheck,
  type Entity,
} from "./wikidata-client.ts";
import { findByTerms } from "./mirror.ts";
import { kindOf, type MusicKind } from "../src/lib/music.ts";
import {
  ALBUM_CLASSES,
  buildPlan,
  describeOp,
  KIND_NAMES,
  type Op,
  QID,
  SINGLE_CLASS,
  type State,
  type Value,
} from "../src/lib/plan.ts";
import { PROPERTY_LABELS } from "../src/lib/preview.ts";
import { performerRows } from "../src/lib/progress.ts";

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
      for (const r of c.references ?? []) for (const s of r) value(s.property, s.value);
    }
  }
  return out;
}

/** Where in the form each QID was entered, e.g. `Performer “X”` or `Composer “X”`. */
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
  const roles = new Map(performerRows(state, buildPlan(state)).map((r) => [r.name, r]));
  for (const [name, qid] of Object.entries(state.artists)) {
    const r = roles.get(name);
    const role =
      !r || r.performer
        ? "Performer"
        : r.composer && r.lyricist
          ? "Composer and lyricist"
          : r.composer
            ? "Composer"
            : "Lyricist";
    add(qid, `${role} “${name}”`);
  }
  state.discs.forEach((d, i) => {
    const disc = `Disc ${i + 1}`;
    add(d.part, `${disc} part`);
    for (const [n, qid] of Object.entries(d.comp)) add(qid, `${disc} track ${n} composition`);
    for (const [n, qid] of Object.entries(d.track)) add(qid, `${disc} track ${n} track`);
    for (const [n, s] of Object.entries(d.single)) add(s.qid, `${disc} track ${n} single`);
    for (const t of d.tracks) if (t.lang) add(t.lang, `${disc} track ${t.n} language`);
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
    const problem = (await checkAlbumKind(album)) ?? (await checkAlbumTracklist(album));
    if (problem) problems.unshift(problem);
  }
  const tracks = new Map<string, Entity>();
  problems.push(...(await checkTrackCompositions(ops, sources, results, tracks)));
  problems.push(...(await checkSingleKinds(ops, sources, results)));
  if (problems.length === 0)
    problems.push(...(await checkTermConflicts(ops, state, sources, results, tracks)));
  if (problems.length > MAX_PROBLEMS)
    return [
      ...problems.slice(0, MAX_PROBLEMS),
      `…and ${problems.length - MAX_PROBLEMS} more problems with the QIDs.`,
    ];
  return problems;
}

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

/** Why the existing album can't take a tracklist, or null if it has none yet. */
async function checkAlbumTracklist(qid: string): Promise<string | null> {
  const n = (await getStatementItems(qid, "P658", { retries: 1 })).length;
  if (n === 0) return null;
  return `The existing album: ${qid} already has a tracklist (P658) with ${n} track${n === 1 ? "" : "s"}. The app only adds tracklists to albums without one.`;
}

/**
 * Reused tracks the run would give a second composition (P2550), one
 * sentence each: one that already records a composition other than one the
 * run links it to, or one used in several rows that link it to different
 * compositions. A track that records a single, album or EP instead is wrongly
 * linked on Wikidata, so its problem says to fix that statement. The tracks,
 * and then what they record, are fetched 50 per request, one request at a time.
 * The tracks are kept in `fetched`.
 */
async function checkTrackCompositions(
  ops: readonly Op[],
  sources: Map<string, string[]>,
  results: Map<string, ItemCheck>,
  fetched: Map<string, Entity>,
): Promise<string[]> {
  // Each existing track, with every composition the run links it to: a QID,
  // or the plan key of one it creates.
  const links = new Map<string, Set<string>>();
  for (const op of ops) {
    if (op.op !== "addClaims" || !("id" in op.target)) continue;
    const v = op.claims.find((c) => c.property === "P2550")?.value;
    if (v?.type !== "item" || results.get(op.target.id)?.status !== "ok") continue;
    const set = links.get(op.target.id) ?? new Set();
    set.add("id" in v ? v.id : v.ref);
    links.set(op.target.id, set);
  }
  // Tracks the run would give a second composition, with what they already record.
  const bad: { qid: string; recorded: string[]; linked: string[] }[] = [];
  const qids = [...links.keys()];
  for (let i = 0; i < qids.length; i += 50) {
    const entities = await getEntities(qids.slice(i, i + 50), { retries: 1 });
    for (const [qid, entity] of entities) {
      fetched.set(qid, entity);
      const recorded = itemValues(entity, "P2550");
      const linked = [...links.get(qid)!];
      if (
        (recorded.length > 0 && linked.some((l) => !recorded.includes(l))) ||
        (recorded.length === 0 && linked.length > 1)
      )
        bad.push({ qid, recorded, linked });
    }
  }
  const releases = await releaseKinds(bad.flatMap((b) => b.recorded));
  const problems: string[] = [];
  for (const { qid, recorded, linked } of bad) {
    const where = sources.get(qid)?.join(", ") ?? "A reused track";
    if (recorded.length === 0) {
      problems.push(
        `${where}: ${qid} is used in more than one row with different compositions. Give each of those rows the same composition, so the track isn't given more than one.`,
      );
      continue;
    }
    const works = recorded.filter((r) => !releases.has(r));
    if (works.length > 0) {
      problems.push(
        `${where}: ${qid} already records the composition ${works.join(", ")}. Put ${works[0]} in the track's composition field, so the track isn't given a second one.`,
      );
      continue;
    }
    // Putting a single in the composition field would only spread the mistake.
    const what = recorded.map((r) => `${r}, ${RELEASE_NAMES[releases.get(r)!]}`).join(", and ");
    const comp = linked.find((l) => QID.test(l));
    problems.push(
      `${where}: ${qid} is a recording of (P2550) ${what}, not a composition. ` +
        (comp
          ? `On Wikidata, change that statement to the composition ${comp}, then start the run again.`
          : `On Wikidata, change that statement to the song's composition and put the composition in the track's composition field, then start the run again.`),
    );
  }
  return problems;
}

/**
 * Existing singles that aren't instances of single, one sentence each. They're
 * fetched 50 per request, one request at a time.
 */
async function checkSingleKinds(
  ops: readonly Op[],
  sources: Map<string, string[]>,
  results: Map<string, ItemCheck>,
): Promise<string[]> {
  const singles = [
    ...new Set(
      ops.flatMap((op) =>
        op.op === "addClaims" &&
        "id" in op.target &&
        op.row?.kind === "single" &&
        results.get(op.target.id)?.status === "ok"
          ? [op.target.id]
          : [],
      ),
    ),
  ];
  const problems: string[] = [];
  for (let i = 0; i < singles.length; i += 50) {
    const entities = await getEntities(singles.slice(i, i + 50), { retries: 1 });
    for (const [qid, entity] of entities) {
      if (itemValues(entity, "P31").includes(SINGLE_CLASS)) continue;
      const where = sources.get(qid)?.join(", ") ?? "An existing single";
      problems.push(
        `${where}: ${qid} isn't an instance of single (${SINGLE_CLASS}). Check the QID.`,
      );
    }
  }
  return problems;
}

const RELEASE_NAMES: Partial<Record<MusicKind, string>> = {
  single: "a single",
  album: "an album",
  ep: "an EP",
};

/** An entity's item values for a property, leaving out deprecated statements. */
function itemValues(entity: Entity, property: string): string[] {
  return (entity.claims?.[property] ?? [])
    .filter((s) => s.rank !== "deprecated")
    .map((s) => (s.mainsnak.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => id !== undefined);
}

/** Which of these items are singles, albums or EPs, by kind. Fetched 50 per request. */
async function releaseKinds(qids: string[]): Promise<Map<string, MusicKind>> {
  const out = new Map<string, MusicKind>();
  const unique = [...new Set(qids)];
  for (let i = 0; i < unique.length; i += 50) {
    const entities = await getEntities(unique.slice(i, i + 50), { retries: 1 });
    for (const [qid, entity] of entities) {
      const kind = kindOf(itemValues(entity, "P31"), []);
      if (kind && kind in RELEASE_NAMES) out.set(qid, kind);
    }
  }
  return out;
}

/** Where a new item's row is in the form, e.g. `disc 1 track 4`, from its plan key. */
function rowOf(key: string): string | null {
  const m = /^(?:comp|track|single):(\d+):(.+)$/.exec(key);
  return m ? `disc ${Number(m[1]) + 1} track ${m[2]}` : null;
}

function newItemName(op: Extract<Op, { op: "create" }>): string {
  const row = rowOf(op.key);
  return `the new ${describeOp(op)}${row ? ` (${row})` : ""}`;
}

/** Where to change a new item's description. */
function descriptionSetting(op: Extract<Op, { op: "create" }>): string {
  if (op.kind === "work") return "the composition description in Item settings";
  if (op.kind === "track" || op.kind === "single")
    return `the ${op.kind} description in Item settings`;
  return "its description in the form";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The label Wikidata pairs with an item's description in `lang` when it checks
 * that label and description are unique: the label in that language or, when
 * there is none, the `mul` label.
 */
const labelFor = (labels: Record<string, string>, lang: string): string | undefined =>
  labels[lang] || labels.mul || undefined;

/**
 * New items that would have the same label and description, in the same
 * language, as another new item or an existing item, one sentence each. A
 * missing label counts as the `mul` label, as on Wikidata. Wikidata refuses
 * to create such an item, which would stop the run partway: a composition
 * described like the existing single in its row, say.
 *
 * The existing items asked about are the reused compositions, tracks and
 * singles, the existing album, and items the local mirror has with the same
 * label and description. Only those languages' labels and descriptions are
 * fetched, and items in `fetched` aren't asked about again. If the mirror
 * can't be read, only the form's items are checked.
 */
async function checkTermConflicts(
  ops: readonly Op[],
  state: State,
  sources: Map<string, string[]>,
  results: Map<string, ItemCheck>,
  fetched: Map<string, Entity>,
): Promise<string[]> {
  const termKey = (lang: string, label: string, desc: string) =>
    JSON.stringify([lang, label, desc]);
  // Each label and description a new item would have, with the items that would have it.
  const fresh = new Map<string, Extract<Op, { op: "create" }>[]>();
  const langs = new Set<string>();
  for (const op of ops) {
    if (op.op !== "create") continue;
    for (const [lang, desc] of Object.entries(op.descriptions)) {
      const label = labelFor(op.labels, lang);
      if (!label || !desc) continue;
      const k = termKey(lang, label, desc);
      fresh.set(k, [...(fresh.get(k) ?? []), op]);
      langs.add(lang);
    }
  }
  if (fresh.size === 0) return [];

  const problems: string[] = [];
  for (const [k, same] of fresh) {
    if (same.length < 2) continue;
    const desc = (JSON.parse(k) as string[])[2];
    const names = same.map(newItemName);
    problems.push(
      `${capitalize(names.slice(0, -1).join(", "))} and ${names[names.length - 1]} would have the same label and description, “${desc}”. ` +
        "Wikidata doesn't allow two items with the same label and description, so give them different descriptions in Item settings.",
    );
  }

  const reused = new Set<string>();
  if (state.album.mode === "existing") reused.add(state.album.qid.trim());
  for (const d of state.discs) {
    for (const q of Object.values(d.comp)) reused.add(q.trim());
    for (const q of Object.values(d.track)) reused.add(q.trim());
    for (const s of Object.values(d.single)) if (s.qid) reused.add(s.qid.trim());
  }
  const qids = [...reused].filter((q) => results.get(q)?.status === "ok");
  const pairs = [...fresh.keys()].map((k) => {
    const [, label, description] = JSON.parse(k) as string[];
    return { label, description };
  });
  const elsewhere = await findByTerms(pairs).catch((err: unknown) => {
    console.warn("Checking the mirror for label and description conflicts failed:", err);
    return [];
  });
  for (const q of elsewhere) if (!reused.has(q) && !qids.includes(q)) qids.push(q);
  const values = (terms: Entity["labels"]) =>
    Object.fromEntries(Object.entries(terms ?? {}).map(([l, t]) => [l, t.value]));
  const terms = await getTerms(
    qids.filter((q) => !fetched.has(q)),
    [...langs, "mul"],
    { retries: 1 },
  );
  for (const [qid, e] of fetched)
    terms.set(qid, {
      status: "ok",
      labels: values(e.labels),
      descriptions: values(e.descriptions),
    });
  for (const [qid, t] of terms) {
    if (t.status !== "ok") continue;
    for (const [lang, desc] of Object.entries(t.descriptions)) {
      const label = labelFor(t.labels, lang);
      const same = label ? fresh.get(termKey(lang, label, desc)) : undefined;
      if (!same) continue;
      const where = sources.get(qid)?.join(", ");
      for (const op of same)
        problems.push(
          `${capitalize(newItemName(op))} would have the same label and description as ${qid}${where ? ` (${where})` : ""}, “${desc}”. ` +
            `Wikidata doesn't allow two items with the same label and description, so it would refuse to create it. ` +
            (reused.has(qid)
              ? `Change the description of ${qid} on Wikidata, or ${descriptionSetting(op)}.`
              : `If ${qid} is the same ${KIND_NAMES[op.kind] ?? "item"}, use it in the form instead. If not, change its description on Wikidata, or ${descriptionSetting(op)}.`),
        );
    }
  }
  return problems;
}
