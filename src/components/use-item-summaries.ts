import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { ALBUM_CLASSES, type Plan, QID, SINGLE_CLASS, type State } from "../lib/plan.ts";
import type { DescribeResponse, ItemSummary } from "../lib/api-types.ts";
import { useDebounced } from "./use-debounced.ts";

/** An item's summary, or where its lookup has got to. */
export type ItemLookup = ItemSummary | { status: "loading" } | { status: "failed" };

const keyOf = (lang: string, qid: string) => `${lang}:${qid}`;

/**
 * Labels, descriptions and classes for `qids`, asked of Wikidata in one
 * request once the list settles. Answers are kept, so only QIDs not seen
 * before (in this language) are asked for. A failed lookup is asked again
 * once its QID has been taken out and entered again.
 */
export function useItemSummaries(
  qids: readonly string[],
  lang: string,
): (qid: string) => ItemLookup | undefined {
  const wanted = [...new Set(qids.filter((q) => QID.test(q)))].sort().join("|");
  const settled = useDebounced(wanted);
  // Both keyed by `keyOf`.
  const [known, setKnown] = useState<Record<string, ItemSummary>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const todo = settled
      .split("|")
      .filter((q) => q && !(keyOf(lang, q) in known) && !failed.has(keyOf(lang, q)));
    if (todo.length === 0) return;
    let cancelled = false;
    api<DescribeResponse>("/api/items/describe", { method: "POST", body: { qids: todo, lang } })
      .then((r) => {
        if (cancelled) return;
        // Every QID asked for gets an answer, so none is asked again.
        const got = todo.map((q) => [keyOf(lang, q), r.items[q] ?? { status: "missing" }]);
        setKnown((k) => ({ ...k, ...Object.fromEntries(got) }));
      })
      .catch(() => {
        if (!cancelled) setFailed((f) => new Set([...f, ...todo.map((q) => keyOf(lang, q))]));
      });
    return () => {
      cancelled = true;
    };
  }, [settled, lang, known, failed]);

  // Forget a failure once its QID is gone from the form.
  const [seen, setSeen] = useState(`${lang}/${wanted}`);
  if (seen !== `${lang}/${wanted}`) {
    setSeen(`${lang}/${wanted}`);
    const present = new Set(wanted.split("|").map((q) => keyOf(lang, q)));
    if ([...failed].some((k) => !present.has(k)))
      setFailed(new Set([...failed].filter((k) => present.has(k))));
  }

  return (qid) => {
    if (!QID.test(qid)) return undefined;
    const k = keyOf(lang, qid);
    return known[k] ?? (failed.has(k) ? { status: "failed" } : { status: "loading" });
  };
}

/**
 * Why an existing album's QID can't be used, or null if it's fine or still
 * being looked up. The run checks this again before it starts.
 */
export function albumProblem(qid: string, found: ItemLookup | undefined): string | null {
  if (found?.status === "missing") return `${qid} doesn't exist on Wikidata.`;
  if (found?.status === "redirect") return `${qid} redirects to ${found.to}. Use ${found.to}.`;
  if (found?.status !== "ok" || found.classes.some((c) => ALBUM_CLASSES.has(c))) return null;
  const name = found.label ? `${qid} (${found.label})` : qid;
  return found.classes.length === 0
    ? `${name} has no “instance of” statement, so it can't be checked to be an album or EP.`
    : `${name} isn't an album or EP. Check the QID.`;
}

/**
 * Why an existing single's QID can't be used, or null if it's fine or still
 * being looked up. The run checks this again before it starts.
 */
export function singleProblem(qid: string, found: ItemLookup | undefined): string | null {
  if (found?.status === "missing") return `${qid} doesn't exist on Wikidata.`;
  if (found?.status === "redirect") return `${qid} redirects to ${found.to}. Use ${found.to}.`;
  if (found?.status === "ok" && !found.classes.includes(SINGLE_CLASS)) {
    const name = found.label ? `${qid} (${found.label})` : qid;
    return `${name} isn't an instance of single (${SINGLE_CLASS}).`;
  }
  return null;
}

/** The existing singles in the tracklist that can't be used, keyed "disc:track". */
export function singleProblems(
  state: State,
  plan: Plan,
  lookup: (qid: string) => ItemLookup | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  plan.tracks.forEach((rows, di) => {
    for (const r of rows) {
      const qid = state.discs[di]?.single[r.n]?.qid.trim() ?? "";
      const problem = QID.test(qid) ? singleProblem(qid, lookup(qid)) : null;
      if (problem) out[`${di}:${r.n}`] = problem;
    }
  });
  return out;
}
