import { useEffect, useState } from "react";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import { normalizeQid, QID, splitArtists } from "../lib/plan.ts";
import type { AddItemResponse, MirrorItem, SearchResponse } from "../lib/api-types.ts";
import { QidInput, WikiLink } from "./common.tsx";
import type { SectionProps } from "./types.ts";

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

  return (
    <section className="block">
      <h2>Performers</h2>
      <p className="hint">
        Every artist name found in the tracklists and album artists, mapped to a QID for P175.
        Matching artists already on Wikidata are suggested.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name in tracklist</th>
              <th>QID</th>
            </tr>
          </thead>
          <tbody>
            {names.size ? (
              [...names].map((n) => {
                const v = (state.artists[n] ?? "").trim();
                const bad = v !== "" && !QID.test(v);
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>
                      <QidInput
                        placeholder="Q… or Wikidata URL"
                        aria-label={`QID for ${n}`}
                        aria-invalid={bad}
                        value={state.artists[n] ?? ""}
                        onChange={(q) => update((s) => void (s.artists[n] = q.trim()))}
                      />
                      {bad && (
                        <p className="field-err">
                          "{v}" isn't a QID. Enter something like Q52583, or paste the item's
                          Wikidata URL.
                        </p>
                      )}
                      {!v && (
                        <Suggestions
                          name={n}
                          version={mirrorVersion}
                          onPick={(qid) => update((s) => void (s.artists[n] = qid))}
                        />
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={2} className="hint">
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

function Suggestions({
  name,
  version,
  onPick,
}: {
  name: string;
  version: number;
  onPick: (qid: string) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const [items, setItems] = useState<MirrorItem[]>([]);
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
  if (!items.length) return null;
  return (
    <ul className="matches">
      {items.slice(0, 5).map((i) => (
        <li key={i.qid}>
          <button type="button" className="ghost small" onClick={() => onPick(i.qid)}>
            Use {i.qid}
          </button>
          <WikiLink base={wikiBaseUrl} qid={i.qid} />
          <span className="muted">{i.description ?? "(no description)"}</span>
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
