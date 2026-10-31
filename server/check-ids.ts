// Before a run starts, check live on Wikidata that no item already has an
// identifier a new item would get (issue #71). The mirror is the weekly dump
// plus what this app has touched since, so an item made elsewhere in between
// isn't in it, and the run would create a second item with the same recording,
// work or album ID.
//
// The Wikidata Query Service is asked once per run, with a `VALUES` row per
// identifier. `p:`/`ps:` with a rank filter, not `wdt:`, so a normal-rank ID
// on an item that also has a preferred one is found, and deprecated IDs are
// skipped. An item made in the minutes the service is behind can be missed,
// but the mirror's gap is a week.
//
// ISRCs (P1243) and ISWCs (P1827) aren't checked: the same one can rightly be
// on more than one item. Items found are added to the mirror, so the form
// matches them the next time it's loaded.
//
// test.wikidata.org has no Query Service, and its property IDs differ from
// Wikidata's, so nothing is checked while the app edits it.
import { DEFAULT_WIKIDATA_API_URL, wikiOrigin } from "./auth/config.ts";
import { userAgent } from "./auth/user-agent.ts";
import { entityToRow, upsertRows } from "./mirror.ts";
import { getEntities, retryAfterMs } from "./wikidata-client.ts";
import { newItemName } from "./check-qids.ts";
import { ID_PROPERTIES } from "../src/lib/music.ts";
import type { Op } from "../src/lib/plan.ts";
import type { TakenId } from "../src/lib/api-types.ts";

export const SPARQL_URL = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_PROBLEMS = 10;

/** The identifiers checked: the ones the mirror stores, but ISWCs. */
const CHECKED = new Set(Object.keys(ID_PROPERTIES).filter((p) => p !== "P1827"));

/** The work and recording IDs, whose item is the very one the form should reuse. */
const SAME_ITEM: Readonly<Record<string, string>> = {
  P435: "composition",
  P4404: "track",
};

type Create = Extract<Op, { op: "create" }>;

export interface PlanId {
  property: string;
  value: string;
  op: Create;
}

/** Every checked identifier the run's new items would get. */
export function planIds(ops: readonly Op[]): PlanId[] {
  const out: PlanId[] = [];
  for (const op of ops) {
    if (op.op !== "create") continue;
    for (const c of op.claims)
      if (CHECKED.has(c.property) && c.value.type === "string" && c.value.value)
        out.push({ property: c.property, value: c.value.value, op });
  }
  return out;
}

/** A SPARQL string literal. */
function literal(s: string): string {
  return `"${s.replace(/[\\"\n\r\t]/g, (ch) => ({ "\n": "\\n", "\r": "\\r", "\t": "\\t" })[ch] ?? `\\${ch}`)}"`;
}

/**
 * The query for the items with any of these identifiers. The statements are
 * looked up by value first: the same patterns item first took 9 seconds for
 * 4 IDs and timed out for 200, where this answers 500 in half a second.
 */
export function idsQuery(ids: readonly { property: string; value: string }[]): string {
  const rows = ids.map(({ property: p, value }) => `    (p:${p} ps:${p} ${literal(value)})`);
  return `SELECT ?item ?p ?value WHERE {
  VALUES (?p ?ps ?value) {
${rows.join("\n")}
  }
  ?st ?ps ?value .
  ?item ?p ?st .
  FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
}`;
}

interface Binding {
  type: string;
  value: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the Query Service, trying again (up to MAX_RETRIES more times) after a
 * dropped connection, a timeout, a 429 or a 5xx, honouring Retry-After. The
 * waits are shorter than the Action API reads': the user is waiting on this.
 * Throws on the last failure, any other error or a non-JSON answer.
 */
async function sparql(query: string): Promise<Record<string, Binding>[]> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    // 2 s, 6 s.
    const backoff = 2_000 * 3 ** attempt;
    try {
      res = await fetch(SPARQL_URL, {
        method: "POST",
        headers: {
          "User-Agent": userAgent(),
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(backoff);
        continue;
      }
      throw err;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(retryAfterMs(res.headers, backoff));
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`the Query Service answered HTTP ${res.status}`);
  const body = (await res.json()) as { results?: { bindings?: Record<string, Binding>[] } };
  if (!Array.isArray(body.results?.bindings))
    throw new Error("the Query Service gave an answer without results");
  return body.results.bindings;
}

const entityId = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

/** Thrown when the identifiers couldn't be checked, so the run mustn't start. */
export class IdCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdCheckError";
  }
}

/**
 * Problems with the identifiers the run's new items would get, one sentence
 * each with the identifier: every one some item on Wikidata already has. Empty when none is
 * taken. Throws an IdCheckError if the Query Service can't be asked.
 */
export async function checkPlanIds(ops: readonly Op[]): Promise<TakenId[]> {
  if (wikiOrigin() !== new URL(DEFAULT_WIKIDATA_API_URL).origin) return [];
  const ids = planIds(ops);
  if (ids.length === 0) return [];
  const unique = [...new Map(ids.map((id) => [`${id.property}\t${id.value}`, id])).values()];

  let rows: Record<string, Binding>[];
  try {
    rows = await sparql(idsQuery(unique));
  } catch (err) {
    throw new IdCheckError(err instanceof Error ? err.message : String(err));
  }

  // Each identifier taken, with the items that have it.
  const taken = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${entityId(r.p.value)}\t${r.value.value}`;
    const set = taken.get(k) ?? new Set();
    set.add(entityId(r.item.value));
    taken.set(k, set);
  }
  if (taken.size === 0) return [];

  const problems: TakenId[] = [];
  for (const { property, value, op } of ids) {
    const qids = [...(taken.get(`${property}\t${value}`) ?? [])].toSorted();
    if (qids.length === 0) continue;
    const name = ID_PROPERTIES[property] ?? property;
    const who =
      qids.length === 1 ? `${qids[0]} already has it` : `${qids.join(" and ")} already have it`;
    const it = qids.length === 1 ? qids[0] : "one of them";
    const same = SAME_ITEM[property];
    let fix: string;
    if (op.key === "album")
      fix = `Use ${it} as the existing ${op.kind === "single" ? "single" : "album"} instead, so it isn't created twice.`;
    else if (same)
      fix = `Put ${it} in that row's ${same} field instead, so it isn't created twice.`;
    else
      fix = `If ${it} is the same ${op.kind === "work" ? "composition" : "track"}, use it in the form instead. If not, fix the ID on Wikidata or run anyway.`;
    problems.push({
      text: `${capitalize(newItemName(op))} would get ${name} ${value}, but ${who}. ${fix}`,
      property,
      value,
    });
  }
  await addToMirror([...new Set([...taken.values()].flatMap((s) => [...s]))]);
  if (problems.length > MAX_PROBLEMS)
    return [
      ...problems.slice(0, MAX_PROBLEMS),
      { text: `…and ${problems.length - MAX_PROBLEMS} more identifiers other items already have.` },
    ];
  return problems;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Add the items found to the mirror. A failure only means the form won't match them yet. */
async function addToMirror(qids: string[]): Promise<void> {
  try {
    const rows = [];
    for (let i = 0; i < qids.length; i += 50) {
      const entities = await getEntities(qids.slice(i, i + 50), { retries: 1 });
      for (const entity of entities.values()) {
        const row = entityToRow(entity);
        if (row) rows.push(row);
      }
    }
    if (rows.length > 0) await upsertRows(rows, { source: "app" });
  } catch (err) {
    console.warn("Adding the items with taken identifiers to the mirror failed:", err);
  }
}
