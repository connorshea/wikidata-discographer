import { useEffect, useId, useRef, useState } from "react";
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
  const { user, wikiBaseUrl } = useAuth();
  // The button that opened the Add a new item dialog, for focus to go back to.
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [added, setAdded] = useState<MirrorItem | null>(null);
  const openAdd = (e: React.MouseEvent<HTMLElement>) => setAdding(e.currentTarget);

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
                    <Suggestions
                      name={r.name}
                      version={mirrorVersion}
                      onPick={set}
                      onAddNew={user ? openAdd : undefined}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint perf-empty">Artists appear here once a disc has tracks.</p>
      )}
      {user && (
        <div className="perf-foot">
          <p>
            Missing an artist that was just created on Wikidata?
            <span role="status">
              {added && (
                <>
                  {" "}
                  Added {added.kind} “{added.label ?? added.qid}”{" "}
                  <span className="mono">
                    (<WikiLink base={wikiBaseUrl} qid={added.qid} />)
                  </span>
                  .
                </>
              )}
            </span>
          </p>
          <button type="button" className="ghost" aria-haspopup="dialog" onClick={openAdd}>
            Add a new item…
          </button>
        </div>
      )}
      <AddItemDialog
        open={adding !== null}
        onAdded={(item) => {
          setAdded(item);
          setMirrorVersion((x) => x + 1);
        }}
        onClose={() => {
          adding?.focus();
          setAdding(null);
        }}
      />
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
  onAddNew,
}: {
  name: string;
  version: number;
  onPick: (qid: string) => void;
  /** Opens Add a new item. Left out when it can't be used (logged out). */
  onAddNew?: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const [items, setItems] = useState<MirrorItem[] | null>(null);
  const addLink = useRef<HTMLButtonElement>(null);
  const firstUse = useRef<HTMLButtonElement>(null);
  // Set when a look again (after an item was added) found something while focus was on the
  // add link, which is then gone: focus goes to the first Use instead.
  const focusUse = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ q: name, kind: "artist" });
    // The last answer stays up while it looks again, so the add link isn't swapped out.
    api<SearchResponse>(`/api/items/search?${q}`)
      .then((r) => {
        if (cancelled) return;
        const found = r.items.filter((i) => i.label?.toLowerCase() === name.toLowerCase());
        focusUse.current =
          found.length > 0 && !!addLink.current && document.activeElement === addLink.current;
        setItems(found);
      })
      .catch(() => !cancelled && setItems((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [name, version]);
  useEffect(() => {
    if (!focusUse.current) return;
    focusUse.current = false;
    firstUse.current?.focus();
  }, [items]);
  if (items === null) return <p className="muted perf-state">Looking for matches…</p>;
  if (!items.length)
    return (
      <p className="perf-none">
        No matching artist on Wikidata. Paste a QID
        {onAddNew ? (
          <>
            , or if you just created one,{" "}
            <button
              ref={addLink}
              type="button"
              className="link"
              aria-haspopup="dialog"
              onClick={onAddNew}
            >
              add it to Discographer
            </button>
            .
          </>
        ) : (
          "."
        )}
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
              ref={n === 0 ? firstUse : undefined}
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

/**
 * A modal dialog that adds an item created since the last weekly sync (an artist, say) to
 * the app's database, so it's suggested and checked for duplicates right away. It's open
 * while `open` is set. Closing it any way (Cancel, ×, Escape, the backdrop, a successful
 * add) calls `onClose`.
 */
function AddItemDialog({
  open,
  onAdded,
  onClose,
}: {
  open: boolean;
  onAdded: (item: MirrorItem) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const errId = useId();
  const [qid, setQid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  const close = () => dialog.current?.close();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!QID.test(qid)) {
      setError(
        qid
          ? `"${qid}" isn't a QID. Enter something like Q52583, or paste the item's Wikidata URL.`
          : "Enter a QID, or paste the item's Wikidata URL.",
      );
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    api<AddItemResponse>(`/api/items/${encodeURIComponent(qid)}`, { method: "POST" })
      .then((r) => {
        onAdded(r.item);
        close();
      })
      .catch((err: unknown) => {
        setError(err instanceof FetchError ? err.message : "Couldn't add it. Try again.");
        input.current?.focus();
      })
      .finally(() => setBusy(false));
  };
  return (
    <dialog
      ref={dialog}
      className="confirm add-item"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={() => {
        setQid("");
        setError(null);
        onClose();
      }}
      // As in ConfirmDialog: a click on the backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <form className="confirm-body" onSubmit={submit} noValidate>
        <div className="add-item-head">
          <h2 id={titleId}>Add a new item</h2>
          <button type="button" className="add-item-x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <p id={bodyId}>
          Discographer's copy of Wikidata's music items is refreshed weekly. If you've created a new
          item on Wikidata, you can load it into Discographer here.
        </p>
        <label className="f">
          QID or Wikidata URL
          <input
            ref={input}
            type="text"
            className="mono"
            spellCheck={false}
            placeholder="Q…"
            aria-invalid={error !== null}
            aria-describedby={error ? errId : undefined}
            value={qid}
            onChange={(e) => {
              setQid(normalizeQid(e.target.value).trim());
              setError(null);
            }}
          />
        </label>
        <p id={errId} className="field-err" role="alert">
          {error}
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add item"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
