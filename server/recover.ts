// Recovering from a create that got no answer (issue #14). When
// `wbeditentity&new=item` times out or gets a 5xx, the item may have been saved
// anyway, possibly after we gave up. Sending the create again on a guess risks
// a duplicate that someone has to merge by hand, so we never do: we only look
// for the item in the user's contributions and use it if exactly one matches.
import { type Entity, getEntities, itemsCreatedBy } from "./wikidata-client.ts";

export interface PendingCreate {
  username: string;
  /** The exact edit summary that was sent. */
  summary: string;
  /** The planned labels, by language. */
  labels: Record<string, string>;
  /** When the create was sent. */
  startedAt: Date;
  /** Items already known to be something else (e.g. made earlier in the run). */
  exclude?: ReadonlySet<string>;
}

// Our clock and Wikimedia's may differ a little.
const CLOCK_SLACK_MS = 60_000;
// A save can't finish this long after it was sent.
const SAVE_WINDOW_MS = 15 * 60_000;

/** After the failure: 10 s, 30 s, 60 s and 120 s, to let the replicas catch up. */
export const LOOK_AT_MS = [10_000, 30_000, 60_000, 120_000];

// MediaWiki stores summaries and labels NFC-normalized, with whitespace collapsed.
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The items that could be this create: made by the user since it was sent,
 * with the summary we sent (which carries the run's EditGroups id) and one
 * of the planned labels. Only one match is safe to use.
 */
export async function findCreated(
  p: PendingCreate,
  { retries = 1 }: { retries?: number } = {},
): Promise<Entity[]> {
  const from = new Date(p.startedAt.getTime() - CLOCK_SLACK_MS);
  const to = new Date(p.startedAt.getTime() + SAVE_WINDOW_MS);
  const summary = norm(p.summary);
  const candidates = (await itemsCreatedBy(p.username, from, to, { retries }))
    .filter((c) => norm(c.comment).includes(summary) && !p.exclude?.has(c.title))
    .map((c) => c.title);
  if (candidates.length === 0) return [];
  const labels = new Set(Object.values(p.labels).map(norm));
  const entities = await getEntities([...new Set(candidates)].slice(0, 50), { retries });
  return [...entities.values()].filter((e) =>
    Object.values(e.labels ?? {}).some((l) => labels.has(norm(l.value))),
  );
}

/**
 * Look for the item at each of `LOOK_AT_MS` after `failedAt`, stopping once
 * anything turns up. A failed look is skipped, not fatal.
 */
export async function waitForCreated(
  p: PendingCreate,
  failedAt: Date,
  lookAt: readonly number[] = LOOK_AT_MS,
): Promise<Entity[]> {
  for (const at of lookAt) {
    await sleep(Math.max(0, failedAt.getTime() + at - Date.now()));
    try {
      const found = await findCreated(p);
      if (found.length > 0) return found;
    } catch (err) {
      console.warn("looking for a created item failed", err);
    }
  }
  return [];
}
