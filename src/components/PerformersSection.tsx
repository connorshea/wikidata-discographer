import { useEffect, useState } from "react";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import { normalizeQid, QID, splitArtists } from "../lib/plan.ts";
import type { AddItemResponse, MirrorItem, SearchResponse } from "../lib/api-types.ts";
import { Pids, QidInput, WikiLink } from "./common.tsx";
import type { SectionProps } from "./types.ts";
import { type ItemLookup, useItemSummaries } from "./use-item-summaries.ts";

export default function PerformersSection({ state, update, plan }: SectionProps) {
  const names = new Set<string>();
  for (const r of plan.parsed.flat())
    if (r.error === undefined) r.artists.forEach((a) => names.add(a));
  if (state.album.mode === "create")
    splitArtists(state.album.artists, state.settings.splitArtists)
      .filter(Boolean)
      .forEach((a) => names.add(a));
  // Bumped when an item is added to the mirror, so the suggestions look again.
  const [mirrorVersion, setMirrorVersion] = useState(0);
  const lookup = useItemSummaries(
    [...names].map((n) => (state.artists[n] ?? "").trim()),
    state.settings.lang,
  );
  const mapped = [...names].filter((n) => {
    const v = (state.artists[n] ?? "").trim();
    const s = lookup(v)?.status;
    return QID.test(v) && s !== "missing" && s !== "redirect";
  }).length;

  return (
    <section className="block">
      <h2>Performers</h2>
      <p className="hint">
        <Pids>
          Every artist name found in the tracklists and album artists, mapped to a QID for P175.
          Matching artists already on Wikidata are suggested. Each name needs a QID before the edits
          can be made.
        </Pids>
      </p>
      <div className="tablewrap">
        <table className="performers">
          <thead>
            <tr>
              <th>Name in tracklist</th>
              <th className="qid">QID</th>
              <th>
                Wikidata item
                {names.size > 0 && (
                  <span className="muted count">
                    {" "}
                    · {mapped} of {names.size} mapped
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {names.size ? (
              [...names].map((n) => {
                const v = (state.artists[n] ?? "").trim();
                const set = (q: string) => update((s) => void (s.artists[n] = q.trim()));
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td className="qid">
                      <QidInput
                        placeholder="Q… or URL"
                        aria-label={`QID for ${n}`}
                        aria-invalid={v !== "" && !QID.test(v)}
                        value={state.artists[n] ?? ""}
                        onChange={set}
                      />
                    </td>
                    <td>
                      {v ? (
                        <Chosen qid={v} found={lookup(v)} onUse={set} />
                      ) : (
                        <Suggestions name={n} version={mirrorVersion} onPick={set} />
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3} className="hint">
                  Artists appear here once a disc has tracks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AddItem onAdded={() => setMirrorVersion((x) => x + 1)} />
    </section>
  );
}

/** What the QID entered for a name points at, or why it can't be used. */
function Chosen({
  qid,
  found,
  onUse,
}: {
  qid: string;
  found: ItemLookup | undefined;
  onUse: (qid: string) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  if (!QID.test(qid))
    return (
      <span className="field-err">
        "{qid}" isn't a QID. Enter something like Q52583, or paste the item's Wikidata URL.
      </span>
    );
  if (found?.status === "missing")
    return <span className="field-err">{qid} doesn't exist on Wikidata.</span>;
  if (found?.status === "redirect")
    return (
      <span className="field-err">
        {qid} redirects to {found.to}.{" "}
        <button type="button" className="ghost small" onClick={() => onUse(found.to)}>
          Use {found.to}
        </button>
      </span>
    );
  if (found?.status === "ok")
    return (
      <span className="item">
        <a href={`${wikiBaseUrl}/wiki/${qid}`} target="_blank" rel="noreferrer">
          {found.label ?? qid}
        </a>
        {found.description && <span className="muted">{found.description}</span>}
      </span>
    );
  return (
    <span className="muted">
      {found?.status === "failed" ? "Couldn’t look it up on Wikidata" : "Looking it up…"}
    </span>
  );
}

function Suggestions({
  name,
  version,
  onPick,
}: {
  name: string;
  version: number;
  onPick: (qid: string) => void;
}) {
  const { user, wikiBaseUrl } = useAuth();
  const [items, setItems] = useState<MirrorItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ q: name, kind: "artist" });
    api<SearchResponse>(`/api/items/search?${q}`)
      .then(
        (r) =>
          !cancelled &&
          setItems(r.items.filter((i) => i.label?.toLowerCase() === name.toLowerCase())),
      )
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [name, version]);
  if (items === null) return <span className="muted">Looking for matches…</span>;
  if (!items.length)
    return (
      <span className="muted">
        No matching artist found.
        {user && " If you just created one on Wikidata, add it below."}
      </span>
    );
  return (
    <ul className="matches">
      {items.slice(0, 5).map((i) => (
        <li key={i.qid}>
          <button
            type="button"
            className="ghost small"
            aria-label={`Use ${i.qid} for ${name}`}
            onClick={() => onPick(i.qid)}
          >
            Use
          </button>
          <span className="item">
            <a href={`${wikiBaseUrl}/wiki/${i.qid}`} target="_blank" rel="noreferrer">
              {i.label ?? i.qid}
            </a>
            <span className="muted">{i.qid}</span>
            {i.description && <span className="muted">{i.description}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Add an item created since the last weekly sync (an artist, say) to the app's database. */
function AddItem({ onAdded }: { onAdded: () => void }) {
  const { user, wikiBaseUrl } = useAuth();
  const [qid, setQid] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; qid?: string } | null>(null);
  if (!user) return null;
  const submit = () => {
    setBusy(true);
    setResult(null);
    api<AddItemResponse>(`/api/items/${encodeURIComponent(qid)}`, { method: "POST" })
      .then((r) => {
        setResult({
          ok: true,
          qid: r.item.qid,
          text: `Added ${r.item.kind} “${r.item.label ?? r.item.qid}”.`,
        });
        setQid("");
        onAdded();
      })
      .catch((e: unknown) =>
        setResult({ ok: false, text: e instanceof FetchError ? e.message : "Failed." }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <details>
      <summary>Missing an artist or album that was just created on Wikidata?</summary>
      <p className="hint">
        The database of music items is refreshed from Wikidata weekly. Add a newer item here so it
        is suggested and checked for duplicates right away.
      </p>
      <div className="row">
        <input
          type="text"
          spellCheck={false}
          placeholder="Q…"
          aria-label="QID to add"
          style={{ maxWidth: "16ch" }}
          value={qid}
          onChange={(e) => setQid(normalizeQid(e.target.value).trim())}
        />
        <button type="button" disabled={busy || !QID.test(qid)} onClick={submit}>
          {busy ? "Adding…" : "Add"}
        </button>
        {result && (
          <span className={`msg ${result.ok ? "ok" : "err"}`}>
            {result.text} {result.qid && <WikiLink base={wikiBaseUrl} qid={result.qid} />}
          </span>
        )}
      </div>
    </details>
  );
}
