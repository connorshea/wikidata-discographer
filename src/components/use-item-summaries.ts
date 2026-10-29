import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { CLASS_KINDS, KIND_NOUNS, kindOf, type MusicKind } from "../lib/music.ts";
import { ALBUM_CLASSES, QID } from "../lib/plan.ts";
import type { DescribeResponse, ItemSummary } from "../lib/api-types.ts";
import { useDebounced } from "./use-debounced.ts";

/** An item's summary, or where its lookup has got to. */
export type ItemLookup = ItemSummary | { status: "loading" } | { status: "failed" };

/** Looks up a QID's summary, and can forget it so it's asked for again. */
export type ItemSummaries = ((qid: string) => ItemLookup | undefined) & {
  /** Ask Wikidata about `qid` again, for an item fixed on Wikidata since. */
  reload: (qid: string) => void;
};

const keyOf = (lang: string, qid: string) => `${lang}:${qid}`;

/**
 * Labels, descriptions and classes for `qids`, asked of Wikidata in one
 * request once the list settles. Answers are kept, so only QIDs not seen
 * before (in this language) are asked for. A failed lookup is asked again
 * once its QID has been taken out and entered again, or reloaded.
 */
export function useItemSummaries(qids: readonly string[], lang: string): ItemSummaries {
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

  const lookup = (qid: string): ItemLookup | undefined => {
    if (!QID.test(qid)) return undefined;
    const k = keyOf(lang, qid);
    return known[k] ?? (failed.has(k) ? { status: "failed" } : { status: "loading" });
  };
  // Forgetting the answer is enough: the effect asks for any QID it doesn't know.
  const reload = (qid: string) => {
    const k = keyOf(lang, qid);
    setKnown((known) => {
      const rest = { ...known };
      delete rest[k];
      return rest;
    });
    setFailed((f) => new Set([...f].filter((x) => x !== k)));
  };
  return Object.assign(lookup, { reload });
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
    ? `${name} has no “instance of” statement, so it can't be checked to be an album, EP or single.`
    : `${name} isn't an album, EP or single. Check the QID.`;
}

/**
 * A release's kind, from its classes on Wikidata: "EP" if any class is an EP, else "Single"
 * if any is a single, else "Album".
 */
export function releaseKind(classes: string[]): "Album" | "EP" | "Single" {
  const is = (kind: MusicKind) =>
    classes.some((c) => CLASS_KINDS.some(([q, k]) => q === c && k === kind));
  return is("ep") ? "EP" : is("single") ? "Single" : "Album";
}

/** Whether the existing release is a single on Wikidata, so it's called one in the form. */
export const existingSingle = (qid: string, found: ItemLookup | undefined): boolean =>
  found?.status === "ok" && !albumProblem(qid, found) && releaseKind(found.classes) === "Single";

/**
 * Why the album a single is taken from looks wrong, from its classes, or null if it's an album
 * or EP. One that's a single, track, composition or artist stops the run. One of a class the app
 * doesn't know may still be an album, so it only gets a warning.
 */
export function takenFromProblem(classes: string[]): string | null {
  const kind = kindOf(classes, []);
  if (kind === "album" || kind === "ep") return null;
  if (kind) {
    const noun = KIND_NOUNS[kind];
    return `This is ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}, not an album or EP. The run won't start with it.`;
  }
  return classes.length
    ? "This isn't an album or EP that Discographer knows. Check it's the right item."
    : "This has no “instance of” statement, so it can't be checked to be an album or EP.";
}
