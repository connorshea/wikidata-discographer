import { useEffect, useState } from "react";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import { normalizeQid, QID } from "../lib/plan.ts";
import { type PerformerRow, performerRows } from "../lib/progress.ts";
import type { AddItemResponse, MirrorItem, SearchResponse } from "../lib/api-types.ts";
import { QidInput, WikiLink } from "./common.tsx";
import type { SectionProps } from "./types.ts";
import { type ItemLookup, useItemSummaries } from "./use-item-summaries.ts";

export default function PerformersSection({ state, update, plan }: SectionProps) {
  const rows = performerRows(state, plan);
  // Bumped when an item is added to the mirror, so the suggestions look again.
  const [mirrorVersion, setMirrorVersion] = useState(0);
  const lookup = useItemSummaries(
    rows.map((r) => (state.artists[r.name] ?? "").trim()),
    state.settings.lang,
  );
  const linked = rows.filter(({ name }) => {
    const v = (state.artists[name] ?? "").trim();
    const s = lookup(v)?.status;
    return QID.test(v) && s !== "missing" && s !== "redirect";
  }).length;

  return (
    <section className="block" id="performers">
      <div className="perf-top">
        <h2>Performers</h2>
        {rows.length > 0 && (
          <span className="perf-count">
            <b>
              {linked} of {rows.length}
            </b>{" "}
            linked
          </span>
        )}
      </div>
      <p className="hint">
        Every artist name in the tracklists, linked to a Wikidata item for performer. Each one needs
        a QID before the run can start.
      </p>
      {rows.length > 0 && (
        <div
          className="perf-bar"
          role="progressbar"
          aria-label="Performers linked"
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={linked}
          aria-valuetext={`${linked} of ${rows.length} linked`}
        >
          <div style={{ width: `${(linked / rows.length) * 100}%` }} />
        </div>
      )}
      {rows.length ? (
        <div className="perf-rows">
          {rows.map((r) => {
            const v = (state.artists[r.name] ?? "").trim();
            const set = (q: string) => update((s) => void (s.artists[r.name] = q.trim()));
            return (
              <div className="perf-row" key={r.name} data-performer={r.name}>
                <PerformerName row={r} />
                <label className="perf-qid">
                  QID
                  <QidInput
                    className="mono"
                    placeholder="Q… or URL"
                    aria-label={`QID for ${r.name}`}
                    aria-invalid={v !== "" && !QID.test(v)}
                    value={state.artists[r.name] ?? ""}
                    onChange={set}
                  />
                </label>
                <div className="perf-result">
                  {v ? (
                    <Chosen qid={v} found={lookup(v)} onUse={set} />
                  ) : (
                    <Suggestions name={r.name} version={mirrorVersion} onPick={set} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint perf-empty">Artists appear here once a disc has tracks.</p>
      )}
      <AddItem onAdded={() => setMirrorVersion((x) => x + 1)} />
    </section>
  );
}

function PerformerName({ row }: { row: PerformerRow }) {
  return (
    <div className="perf-name">
      <b>{row.name}</b>
      <ul className="pills">
        {row.albumArtist && <li className="pill">Album artist</li>}
        <li className="pill">
          {row.tracks} {row.tracks === 1 ? "track" : "tracks"}
        </li>
      </ul>
    </div>
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
      <p className="field-err">
        "{qid}" isn't a QID. Enter something like Q52583, or paste the item's Wikidata URL.
      </p>
    );
  if (found?.status === "missing")
    return <p className="field-err">{qid} doesn't exist on Wikidata.</p>;
  if (found?.status === "redirect")
    return (
      <p className="field-err">
        {qid} redirects to {found.to}.{" "}
        <button type="button" className="ghost small" onClick={() => onUse(found.to)}>
          Use {found.to}
        </button>
      </p>
    );
  if (found?.status === "ok")
    return (
      <div className="perf-linked">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="8" />
          <path d="M5.5 9.2l2.3 2.3 4.7-5" />
        </svg>
        <span className="perf-linked-text">
          <a href={`${wikiBaseUrl}/wiki/${qid}`} target="_blank" rel="noreferrer">
            {found.label ?? qid} ↗
          </a>
          {found.description && <span>{found.description}</span>}
        </span>
      </div>
    );
  return (
    <p className="muted perf-state">
      {found?.status === "failed" ? "Couldn’t look it up on Wikidata" : "Looking it up…"}
    </p>
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
  if (items === null) return <p className="muted perf-state">Looking for matches…</p>;
  if (!items.length)
    return (
      <p className="perf-none">
        No matching artist on Wikidata.{" "}
        {user ? "Paste a QID, or if you just created one, add it below." : "Paste a QID."}
      </p>
    );
  return (
    <div className="perf-suggest">
      <p className="muted">
        {items.length === 1
          ? "1 artist on Wikidata has this name"
          : `${items.length} artists on Wikidata have this name`}
      </p>
      <ul>
        {items.slice(0, 5).map((i, n) => (
          <li key={i.qid}>
            <span className="perf-suggest-text">
              <span className="match-label">
                <a href={`${wikiBaseUrl}/wiki/${i.qid}`} target="_blank" rel="noreferrer">
                  {i.label ?? i.qid} ↗
                </a>
                <span className="mono muted">{i.qid}</span>
              </span>
              {i.description && <span className="muted">{i.description}</span>}
            </span>
            <button
              type="button"
              className={n === 0 ? "small" : "ghost small"}
              aria-label={`Use ${i.qid} for ${name}`}
              onClick={() => onPick(i.qid)}
            >
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
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
