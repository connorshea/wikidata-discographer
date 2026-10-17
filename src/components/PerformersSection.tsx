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
  const all = performerRows(state, plan);
  // Bumped when an item is added to the mirror, so the suggestions look again.
  const [mirrorVersion, setMirrorVersion] = useState(0);
  const lookup = useItemSummaries(
    all.map((r) => (state.artists[r.name] ?? "").trim()),
    state.settings.lang,
  );
  const isLinked = (name: string) => {
    const v = (state.artists[name] ?? "").trim();
    const s = lookup(v)?.status;
    return QID.test(v) && s !== "missing" && s !== "redirect";
  };
  // Rows the user opened (with Change, or by typing in one), by whether each was linked then.
  // An open row stays open, and in its place, until Done or Use.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const settled = (name: string) => opened[name] ?? isLinked(name);
  const rows = [...all].sort((a, b) => Number(settled(a.name)) - Number(settled(b.name)));
  const linked = all.filter((r) => isLinked(r.name)).length;
  // A row that just closed, for focus to go to its Change button.
  const closing = useRef<string | null>(null);
  useEffect(() => {
    const name = closing.current;
    if (name === null) return;
    closing.current = null;
    findRow(name)?.querySelector<HTMLButtonElement>(".perf-change")?.focus();
  });
  const open = (name: string) =>
    setOpened((o) => (name in o ? o : { ...o, [name]: isLinked(name) }));
  const close = (name: string) => {
    closing.current = name;
    setOpened((o) => {
      const { [name]: _closed, ...rest } = o;
      return rest;
    });
  };
  const { user, wikiBaseUrl } = useAuth();
  // The button that opened the Add a new item dialog, for focus to go back to.
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [added, setAdded] = useState<MirrorItem | null>(null);
  const openAdd = (e: React.MouseEvent<HTMLElement>) => setAdding(e.currentTarget);

  return (
    <section className="block" id="performers">
      <div className="perf-top">
        <h2>Performers</h2>
        {all.length > 0 && (
          <span className={linked < all.length ? "pill warn" : "pill"}>
            {linked} of {all.length} linked
          </span>
        )}
        {user && (
          <button
            type="button"
            className="quiet small perf-add"
            aria-haspopup="dialog"
            onClick={openAdd}
          >
            Add a new item…
          </button>
        )}
      </div>
      <p className="hint">
        Link every artist name in the tracklist to its Wikidata item. Unlinked artists are listed
        first.
      </p>
      <p className="perf-added" role="status">
        {added && (
          <>
            Added {added.kind} “{added.label ?? added.qid}”{" "}
            <span className="mono">
              (<WikiLink base={wikiBaseUrl} qid={added.qid} />)
            </span>
            .
          </>
        )}
      </p>
      {rows.length ? (
        <div className="perf-rows">
          {rows.map((r) => {
            const v = (state.artists[r.name] ?? "").trim();
            const found = lookup(v);
            const ok = isLinked(r.name);
            const set = (q: string) => update((s) => void (s.artists[r.name] = q.trim()));
            if (ok && !(r.name in opened))
              return (
                <div className="perf-row linked" key={r.name} data-performer={r.name}>
                  <StatusIcon linked />
                  <PerformerName row={r} />
                  <div className="perf-line">
                    <Chosen qid={v} found={found} showQid />
                    <button
                      type="button"
                      className="quiet small perf-change"
                      aria-label={`Change the item for ${r.name}`}
                      onClick={() => {
                        open(r.name);
                        // The row opens with its input where Change was.
                        requestAnimationFrame(() =>
                          findRow(r.name)?.querySelector("input")?.focus(),
                        );
                      }}
                    >
                      Change
                    </button>
                  </div>
                </div>
              );
            const input = (
              <QidInput
                className="mono"
                placeholder="Q… or Wikidata URL"
                aria-label={`QID for ${r.name}`}
                aria-invalid={v !== "" && !QID.test(v)}
                value={state.artists[r.name] ?? ""}
                onChange={(q) => {
                  open(r.name);
                  set(q);
                }}
              />
            );
            return (
              <div className="perf-row" key={r.name} data-performer={r.name}>
                <StatusIcon linked={ok} />
                <PerformerName row={r} />
                <div className="perf-pick">
                  {ok ? (
                    <div className="perf-edit">
                      {input}
                      <button type="button" className="quiet small" onClick={() => close(r.name)}>
                        Done
                      </button>
                    </div>
                  ) : (
                    input
                  )}
                  {v ? (
                    <Chosen qid={v} found={found} onUse={set} />
                  ) : (
                    <Suggestions
                      name={r.name}
                      version={mirrorVersion}
                      onPick={(q) => {
                        set(q);
                        close(r.name);
                      }}
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

function findRow(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("#performers [data-performer]")].find(
    (el) => el.dataset.performer === name,
  );
}

/** A green check once a name is linked, an amber ring until then. */
function StatusIcon({ linked }: { linked: boolean }) {
  return (
    <svg className="perf-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {linked ? (
        <>
          <circle className="done" cx="8" cy="8" r="7" />
          <path d="M4.8 8.2l2 2 4.2-4.4" />
        </>
      ) : (
        <circle className="todo" cx="8" cy="8" r="6.5" />
      )}
    </svg>
  );
}

function PerformerName({ row }: { row: PerformerRow }) {
  return (
    <span className="perf-name">
      <b>{row.name}</b>
      <span className="muted">
        {row.albumArtist && "Album artist · "}
        {row.tracks} {row.tracks === 1 ? "track" : "tracks"}
      </span>
    </span>
  );
}

/** What the QID entered for a name points at, or why it can't be used. */
function Chosen({
  qid,
  found,
  onUse,
  showQid,
}: {
  qid: string;
  found: ItemLookup | undefined;
  onUse?: (qid: string) => void;
  /** Shows the QID by the label, for a closed row that has no input showing it. */
  showQid?: boolean;
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
        {onUse && (
          <button type="button" className="use small" onClick={() => onUse(found.to)}>
            Use {found.to}
          </button>
        )}
      </p>
    );
  return (
    <span className="perf-item">
      <a href={`${wikiBaseUrl}/wiki/${qid}`} target="_blank" rel="noreferrer">
        {(found?.status === "ok" && found.label) || qid} ↗
      </a>
      {showQid && found?.status === "ok" && found.label && (
        <span className="mono muted">{qid}</span>
      )}
      {found?.status === "ok" ? (
        found.description && <span className="muted">{found.description}</span>
      ) : (
        <span className="muted">
          {found?.status === "failed" ? "Couldn’t look it up on Wikidata" : "Looking it up…"}
        </span>
      )}
    </span>
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
  if (items === null) return <p className="muted perf-note">Looking for matches…</p>;
  if (!items.length)
    return (
      <p className="muted perf-note">
        No artist on Wikidata has this name. Paste a QID
        {onAddNew ? (
          <>
            , or{" "}
            <button
              ref={addLink}
              type="button"
              className="link"
              aria-haspopup="dialog"
              onClick={onAddNew}
            >
              add one you just created
            </button>
            .
          </>
        ) : (
          "."
        )}
      </p>
    );
  return (
    <>
      <p className="muted perf-note">
        {items.length === 1
          ? "1 artist on Wikidata has this name"
          : `${items.length} artists on Wikidata have this name`}
      </p>
      <ul className="perf-suggest">
        {items.slice(0, 5).map((i, n) => (
          <li key={i.qid}>
            <span className="perf-item">
              <a href={`${wikiBaseUrl}/wiki/${i.qid}`} target="_blank" rel="noreferrer">
                {i.label ?? i.qid} ↗
              </a>
              <span className="mono muted">{i.qid}</span>
              {i.description && <span className="muted">{i.description}</span>}
            </span>
            <button
              ref={n === 0 ? firstUse : undefined}
              type="button"
              className="use small"
              aria-label={`Use ${i.qid} for ${name}`}
              onClick={() => onPick(i.qid)}
            >
              Use
            </button>
          </li>
        ))}
      </ul>
    </>
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
