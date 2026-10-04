import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { QID } from "../lib/plan.ts";
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
