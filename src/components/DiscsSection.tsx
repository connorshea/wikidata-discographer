import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { DISCOGS_FIELD, normalizeAlbumId } from "../lib/music.ts";
import { groupId, type TrackReview } from "../lib/matches.ts";
import {
  albumArtists,
  isCustomPart,
  normalizeDate,
  normalizeQid,
  PARTS,
  parseDate,
  QID,
  SINGLE_CLASS,
  type Disc,
  type Plan,
  type RowErrs,
  type Settings,
  type Track,
} from "../lib/plan.ts";
import { emptyDisc, splitArtists } from "../lib/state.ts";
import {
  addTrack,
  formatLength,
  insertTracks,
  lengthText,
  moveTrack,
  parseLength,
  pastedTracks,
  removeTrack,
  type Renumbered,
} from "../lib/tracks.ts";
import { InfoTip, Pids, QidInput, WikiLink } from "./common.tsx";
import { ConfirmButton } from "./ConfirmDialog.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import { type ItemLookup, useItemSummaries } from "./use-item-summaries.ts";
import type { SectionProps } from "./types.ts";

const cls = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

let lastKey = 0;
/** A new key for a row, unique on the page. */
const newKey = () => ++lastKey;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A disc's part as its tab shows it: "CD1", or the QID of one the app doesn't know. */
function partLabel(d: Disc): string {
  const q = d.part.trim();
  for (const [, opts] of PARTS) for (const [p, label] of opts) if (p === q) return label;
  return q;
}

/** Whether a disc has a problem to fix in one of its rows or singles. */
const discHasErrors = (plan: Plan, di: number) =>
  [...Object.keys(plan.rowErrs), ...Object.keys(plan.singleErrs)].some((k) =>
    k.startsWith(`${di}:`),
  );

export default function DiscsSection({
  state,
  update,
  plan,
  reviews,
  onRenumber,
}: SectionProps & {
  reviews: TrackReview[];
  /** The rows of disc `di` were renumbered, so whatever's kept by track number should follow. */
  onRenumber: (di: number, moved: Renumbered) => void;
}) {
  const lookup = useItemSummaries(
    state.discs.flatMap((d) => Object.values(d.single).map((sg) => sg.qid.trim())),
    state.settings.lang,
  );
  const [tab, setTab] = useState(0);
  const di = Math.min(tab, state.discs.length - 1);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabsId = useId();
  const pick = (i: number, focus = false) => {
    setTab(i);
    if (focus) tabs.current[i]?.focus();
  };
  return (
    <section className="block" id="tracks">
      <div className="album-head">
        <h2>
          <span className="sw" style={{ background: "var(--trk-edge)" }} aria-hidden="true" />
          Tracks
        </h2>
      </div>
      <div className="disc-tabs">
        <div role="tablist" aria-label="Discs">
          {state.discs.map((d, i) => {
            const toReview = reviews.some((r) => r.di === i && !r.reviewed);
            const errors = discHasErrors(plan, i);
            return (
              <button
                key={i}
                ref={(el) => void (tabs.current[i] = el)}
                type="button"
                role="tab"
                id={`${tabsId}-${i}`}
                aria-selected={i === di}
                aria-controls={`${tabsId}-panel`}
                tabIndex={i === di ? 0 : -1}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  const last = state.discs.length - 1;
                  const to = {
                    ArrowRight: i === last ? 0 : i + 1,
                    ArrowLeft: i === 0 ? last : i - 1,
                    Home: 0,
                    End: last,
                  }[e.key];
                  if (to === undefined) return;
                  e.preventDefault();
                  pick(to, true);
                }}
              >
                Disc {i + 1}{" "}
                <span className="muted">
                  {[partLabel(d), String(d.tracks.length)].filter(Boolean).join(" · ")}
                </span>
                {errors && (
                  <span className="tab-dot err">
                    <span className="visually-hidden">, has errors</span>
                  </span>
                )}
                {toReview && (
                  <span className="tab-dot warn">
                    <span className="visually-hidden">, has matches to review</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="link add-disc"
          onClick={() => {
            update((s) => void s.discs.push(emptyDisc()));
            pick(state.discs.length);
          }}
        >
          + Add disc
        </button>
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${di}`}>
        <DiscBlock
          key={di}
          di={di}
          reviews={reviews.filter((r) => r.di === di)}
          lookup={lookup}
          onRenumber={(moved) => onRenumber(di, moved)}
          onRemove={() => {
            update((s) => void s.discs.splice(di, 1));
            pick(Math.max(0, di - 1), true);
          }}
          {...{ state, update, plan }}
        />
      </div>
    </section>
  );
}

/** A cell of the row editor: a column and the row's index. */
type CellAt = { row: number; col: string };

function DiscBlock({
  di,
  reviews,
  lookup,
  onRenumber,
  onRemove,
  state,
  update,
  plan,
}: SectionProps & {
  di: number;
  reviews: TrackReview[];
  lookup: Lookup;
  onRenumber: (moved: Renumbered) => void;
  onRemove: () => void;
}) {
  const d = state.discs[di];
  const rows = plan.tracks[di] ?? [];
  const open = new Map(reviews.filter((r) => !r.reviewed).map((r) => [r.n, r]));
  const custom = isCustomPart(d);
  const creating = state.album.mode === "create";
  // Rows typed in, or added to an import, can be moved and removed. A plain import is a
  // release's tracklist, so it's left as it is.
  const manual = state.start !== "mb" || d.tracks.some((t) => !t.mb);
  const cols = manual ? 8 : 6;
  const setDisc = (fn: (disc: Disc) => void) => update((s) => fn(s.discs[di]));
  const ids = useId();
  const known = [...Object.keys(state.artists), ...albumArtists(state)];

  // A key for each row that follows it when rows move, so React moves the row's
  // inputs (and the focus in them) along with it.
  const [keys, setKeys] = useState(() => d.tracks.map(newKey));
  if (keys.length !== d.tracks.length)
    setKeys([...keys.slice(0, d.tracks.length), ...d.tracks.slice(keys.length).map(newKey)]);

  const table = useRef<HTMLTableElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The cell to focus once the rows have changed.
  const focusNext = useRef<CellAt | null>(null);
  const setFocusNext = (at: CellAt) => void (focusNext.current = at);
  const [said, setSaid] = useState("");
  useLayoutEffect(() => {
    const at = focusNext.current;
    if (!at) return;
    focusNext.current = null;
    const el = table.current?.querySelector<HTMLElement>(
      `[data-row="${at.row}"] [data-col="${at.col}"]`,
    );
    (el ?? addButton.current)?.focus();
  });

  /** Change the rows' order or number, then tell whatever keeps rows by number. */
  const reorder = (fn: (disc: Disc) => Renumbered) => {
    const next = structuredClone(d);
    const moved = fn(next);
    setDisc((disc) => Object.assign(disc, structuredClone(next)));
    onRenumber(moved);
  };
  const add = (focus: string) => {
    setDisc(addTrack);
    setFocusNext({ row: d.tracks.length, col: focus });
  };
  const move = (from: number, to: number, focus = "grip") => {
    if (to < 0 || to >= d.tracks.length || to === from) return;
    setKeys((ks) => {
      const next = [...ks];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
    reorder((disc) => moveTrack(disc, from, to));
    setFocusNext({ row: to, col: focus });
    setSaid(`Track moved to position ${to + 1} of ${d.tracks.length}.`);
  };
  const remove = (i: number) => {
    const title = d.tracks[i].title.trim();
    setKeys((ks) => ks.filter((_, j) => j !== i));
    reorder((disc) => removeTrack(disc, i));
    setFocusNext({ row: Math.min(i, d.tracks.length - 2), col: "remove" });
    setSaid(`Removed track ${i + 1}${title ? `, ${title}` : ""}.`);
  };
  /** A list pasted into a title: its first line fills a blank row, the rest are rows after it. */
  const paste = (i: number, text: string): boolean => {
    const lines = pastedTracks(text);
    if (!lines) return false;
    const t = d.tracks[i];
    const fill = !t.title.trim();
    const rest = fill ? lines.slice(1) : lines;
    setKeys((ks) => [...ks.slice(0, i + 1), ...rest.map(newKey), ...ks.slice(i + 1)]);
    reorder((disc) => {
      if (fill) {
        disc.tracks[i].title = lines[0].title;
        if (lines[0].length && !lengthText(disc.tracks[i])) disc.tracks[i].length = lines[0].length;
      }
      return insertTracks(
        disc,
        i,
        rest.map((l) => ({
          title: l.title,
          artists: [],
          seconds: null,
          mb: null,
          ...(l.length ? { length: l.length } : {}),
        })),
      );
    });
    setSaid(`Added ${plural(lines.length, "track")} from the pasted list.`);
    return true;
  };
  /** Enter moves down a row, and adds one from the last. */
  const enter = (i: number, col: string) => {
    if (i === d.tracks.length - 1) add("title");
    else setFocusNext({ row: i + 1, col });
  };

  // Dragging a row by its handle: the row it's over, to drop it there.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const rowAt = (y: number) => {
    const trs = [...(table.current?.querySelectorAll<HTMLElement>("tr[data-row]") ?? [])];
    const i = trs.findIndex((tr) => y < tr.getBoundingClientRect().bottom);
    return i === -1 ? trs.length - 1 : i;
  };

  return (
    <div className="disc-panel">
      <div className="disc-bar">
        <label className="f">
          <Pids>Part (P518 on the tracklist)</Pids>
          <select
            value={custom ? "other" : d.part}
            onChange={(e) =>
              setDisc((disc) => {
                disc.partCustom = e.target.value === "other";
                disc.part = e.target.value === "other" ? "" : e.target.value;
              })
            }
          >
            <option value="">None</option>
            {PARTS.map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map(([q, l]) => (
                  <option key={q} value={q}>{`${l} (${q})`}</option>
                ))}
              </optgroup>
            ))}
            <option value="other">Other QID…</option>
          </select>
          {custom && (
            <input
              type="text"
              spellCheck={false}
              placeholder="Q…"
              aria-label={`Disc ${di + 1} part QID`}
              value={d.part}
              onChange={(e) => setDisc((disc) => void (disc.part = normalizeQid(e.target.value)))}
            />
          )}
        </label>
        <span className="sub">Leave as None for a single-disc album.</span>
        {state.discs.length > 1 && (
          <ConfirmButton
            label="Remove disc"
            className="danger small remove-disc"
            confirm={
              d.tracks.length
                ? {
                    title: `Remove disc ${di + 1}?`,
                    body: `This removes its ${plural(d.tracks.length, "track")}, and the items and singles linked to them. It can't be undone.`,
                    action: "Remove disc",
                  }
                : null
            }
            onConfirm={onRemove}
          />
        )}
      </div>
      {open.size > 0 && <UnreviewedNotice count={open.size} />}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="tracks" ref={table}>
            <thead>
              <tr>
                {manual && (
                  <th className="grip-col">
                    <span className="visually-hidden">Move</span>
                  </th>
                )}
                <th>#</th>
                <th>Title</th>
                <th>Artists</th>
                <th>Length</th>
                <th>Links to existing</th>
                <th className="single-toggle">
                  Single
                  <InfoTip id={`disc${di}-single`} label="About singles" end>
                    Tick a track that was also released as a single. The single becomes its own
                    item, an instance of single (Q134556) with the track’s title and artists, that
                    lists the track and is taken from the album. Its Edit button sets the new
                    single’s release date, or an existing single’s QID to link that one instead, and
                    its Discogs master ID. Currently, you can only create singles with one track.
                  </InfoTip>
                </th>
                {manual && (
                  <th>
                    <span className="visually-hidden">Remove</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const t = d.tracks[i];
                const errs: RowErrs = plan.rowErrs[`${di}:${r.n}`] ?? {};
                const cell = (col: string) => ({
                  "data-col": col,
                  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    e.currentTarget.blur();
                    enter(i, col);
                  },
                });
                const dragging = drag && drag.from !== drag.to;
                return (
                  <Fragment key={keys[i]}>
                    <tr
                      data-row={i}
                      className={cls(
                        d.single[r.n] && "has-sub",
                        d.single[r.n] && "is-single",
                        dragging && drag.from === i && "dragging",
                        dragging &&
                          drag.to === i &&
                          (drag.to < drag.from ? "drop-before" : "drop-after"),
                      )}
                    >
                      {manual && (
                        <td className="grip-col">
                          <button
                            type="button"
                            className="grip"
                            data-col="grip"
                            aria-label={`Move track ${r.n}`}
                            aria-describedby={`${ids}-grip`}
                            onKeyDown={(e) => {
                              const to = { ArrowUp: i - 1, ArrowDown: i + 1 }[e.key];
                              if (to === undefined) return;
                              e.preventDefault();
                              move(i, to);
                            }}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.currentTarget.setPointerCapture(e.pointerId);
                              setDrag({ from: i, to: i });
                            }}
                            onPointerMove={(e) =>
                              drag && setDrag({ from: drag.from, to: rowAt(e.clientY) })
                            }
                            onPointerUp={() => {
                              if (drag) move(drag.from, drag.to);
                              setDrag(null);
                            }}
                            onPointerCancel={() => setDrag(null)}
                          >
                            <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
                              {[4, 8, 12].map((y) => (
                                <Fragment key={y}>
                                  <circle cx="4" cy={y} r="1.3" />
                                  <circle cx="8" cy={y} r="1.3" />
                                </Fragment>
                              ))}
                            </svg>
                          </button>
                        </td>
                      )}
                      <td className="num">{r.n}</td>
                      <td className="title-col">
                        <span className="title-cell">
                          <Cell
                            {...cell("title")}
                            label={`Track ${r.n} title`}
                            placeholder="Title"
                            value={t.title}
                            error={errs.title}
                            onChange={(v) => setDisc((disc) => void (disc.tracks[i].title = v))}
                            onPaste={(e) => {
                              if (paste(i, e.clipboardData.getData("text"))) e.preventDefault();
                            }}
                          />
                          {open.has(r.n) && <MatchFlag review={open.get(r.n)!} />}
                          <MbChip track={r} settings={state.settings} />
                        </span>
                      </td>
                      <td className="artists-col">
                        <ArtistsCell
                          {...cell("artists")}
                          label={`Track ${r.n} artists`}
                          placeholder={creating ? "Album artist" : "Artists"}
                          artists={t.artists}
                          known={known}
                          error={errs.artists}
                          onCommit={(names) =>
                            setDisc((disc) => void (disc.tracks[i].artists = names))
                          }
                        />
                      </td>
                      <td className="length-col">
                        <Cell
                          {...cell("length")}
                          className="mono"
                          label={`Track ${r.n} length`}
                          placeholder="m:ss"
                          value={lengthText(t)}
                          error={errs.length}
                          onChange={(v) => setDisc((disc) => void (disc.tracks[i].length = v))}
                          onBlur={() =>
                            setDisc((disc) => {
                              const row = disc.tracks[i];
                              if (row.length === undefined) return;
                              const parsed = parseLength(row.length);
                              if (!parsed.ok) return;
                              // Typed back to what was imported: it's the imported length again.
                              if (parsed.seconds === row.seconds) delete row.length;
                              else row.length = formatLength(parsed.seconds);
                            })
                          }
                        />
                      </td>
                      <td className="links-col">
                        <LinksCell n={r.n} errs={errs} disc={d} setDisc={setDisc} />
                      </td>
                      <td className="single-toggle">
                        <input
                          type="checkbox"
                          aria-label={`Track ${r.n} is a single`}
                          checked={!!d.single[r.n]}
                          onChange={(e) =>
                            update((s) => {
                              const disc = s.discs[di];
                              if (e.target.checked)
                                disc.single[r.n] = { date: "", qid: "", discogs: "" };
                              else delete disc.single[r.n];
                            })
                          }
                        />
                      </td>
                      {manual && (
                        <td>
                          <button
                            type="button"
                            className="rm"
                            data-col="remove"
                            aria-label={`Remove track ${r.n}`}
                            onClick={() => remove(i)}
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                    {d.single[r.n] && (
                      <tr className="sub-row is-single">
                        <td colSpan={manual ? 2 : 1} />
                        <td colSpan={cols - (manual ? 2 : 1)}>
                          <SingleRow di={di} n={r.n} {...{ lookup, state, update, plan }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="add-track">
        <button ref={addButton} type="button" className="ghost" onClick={() => add("title")}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M7 2v10M2 7h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          Add track
        </button>
        <span className="sub">
          {rows.length ? "Press Enter in the last row to add another. " : ""}
          Paste a list into a title to add a row per line.
          {creating ? " Empty artists use the album artist." : ""}
        </span>
      </div>
      <span id={`${ids}-grip`} hidden>
        Drag, or press the up and down arrow keys, to move it.
      </span>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * An editable cell that reads as text until it's hovered or focused. Its error
 * shows under it once it's left, rather than while it's being typed.
 */
function Cell({
  label,
  value,
  error,
  className,
  onChange,
  onFocus,
  onBlur,
  ...rest
}: {
  label: string;
  value: string;
  error?: string;
  className?: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onFocus" | "onBlur" | "className"
> & { "data-col": string }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const shown = !focused && error;
  return (
    <>
      <input
        type="text"
        className={cls("cell", className)}
        aria-label={label}
        aria-invalid={!!shown}
        aria-describedby={shown ? id : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        {...rest}
      />
      {shown && <CellErr id={id}>{error}</CellErr>}
    </>
  );
}

function CellErr({ id, children }: { id: string; children: string }) {
  return (
    <span className="cell-err" id={id}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 3.4v3M6 8.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      {children}
    </span>
  );
}

/**
 * A row's artists as one cell, "A, B feat. C". They're split into names when
 * it's left, keeping known names such as "Tyler, the Creator" whole.
 */
function ArtistsCell({
  artists,
  known,
  onCommit,
  ...rest
}: {
  label: string;
  placeholder: string;
  artists: string[];
  known: string[];
  error?: string;
  onCommit: (names: string[]) => void;
  "data-col": string;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const joined = artists.join(", ");
  return (
    <Cell
      {...rest}
      value={draft ?? joined}
      onFocus={() => setDraft(joined)}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== null && draft !== joined) onCommit(splitArtists(draft, known));
        setDraft(null);
      }}
    />
  );
}

/**
 * The existing composition and track a row reuses, as chips. "Link existing…"
 * opens their QID fields, which stay open while one isn't a QID.
 */
function LinksCell({
  n,
  errs,
  disc,
  setDisc,
}: {
  n: number;
  errs: RowErrs;
  disc: Disc;
  setDisc: (fn: (disc: Disc) => void) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const problem = !!(errs.comp || errs.track);
  const isOpen = editing || problem;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen === wasOpen.current) return;
    wasOpen.current = isOpen;
    if (isOpen && editing) panel.current?.querySelector("input")?.focus();
    if (!isOpen) button.current?.focus();
  }, [isOpen, editing]);

  const kinds = [
    { k: "comp", name: "Composition", lower: "composition" },
    { k: "track", name: "Track", lower: "track" },
  ] as const;
  const set = (k: "comp" | "track", q: string) =>
    setDisc((d) => {
      if (q.trim()) d[k][n] = q.trim();
      else delete d[k][n];
    });

  if (isOpen)
    return (
      <div
        className="links-edit"
        ref={panel}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !problem) setEditing(false);
        }}
      >
        {kinds.map(({ k, name, lower }) => (
          <label key={k} className="f">
            {name}
            <QidInput
              placeholder="Q…"
              aria-label={`Track ${n} existing ${lower}`}
              aria-invalid={!!errs[k]}
              aria-describedby={errs[k] ? `${ids}-${k}` : undefined}
              value={disc[k][n] ?? ""}
              onChange={(q) => set(k, q)}
            />
            {errs[k] && <CellErr id={`${ids}-${k}`}>{errs[k]}</CellErr>}
          </label>
        ))}
        <button
          type="button"
          className="ghost small"
          aria-label={`Done linking track ${n}`}
          onClick={() => !problem && setEditing(false)}
        >
          Done
        </button>
      </div>
    );
  const linked = kinds.filter(({ k }) => QID.test((disc[k][n] ?? "").trim()));
  return (
    <span className="links">
      {linked.map(({ k, name, lower }) => {
        const q = disc[k][n].trim();
        return (
          <span key={k} className={`link-chip ${k}`}>
            <i aria-hidden="true" />
            {name} <WikiLink base={wikiBaseUrl} qid={q} />
            <button
              type="button"
              aria-label={`Unlink ${lower} from track ${n}`}
              onClick={() => set(k, "")}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        ref={button}
        type="button"
        className="link"
        aria-label={linked.length ? `Edit links for track ${n}` : undefined}
        onClick={() => setEditing(true)}
      >
        {linked.length ? "Edit" : "Link existing…"}
      </button>
    </span>
  );
}

/**
 * A track's single, on its own row under the track: a one-line summary, or
 * its fields once Edit is clicked. The fields stay open while something is
 * wrong with them, and Done only closes them once nothing is.
 */
function SingleRow({
  di,
  n,
  lookup,
  state,
  update,
  plan,
}: SectionProps & { di: number; n: number; lookup: Lookup }) {
  const { wikiBaseUrl } = useAuth();
  const sg = state.discs[di].single[n];
  const qid = sg.qid.trim();
  const date = sg.date.trim();
  const discogs = sg.discogs.trim();
  const found = QID.test(qid) ? lookup(qid) : undefined;
  const notSingle = singleProblem(qid, found);
  const problem = [plan.singleErrs[`${di}:${n}`], notSingle].filter(Boolean).join(" ");
  const [editing, setEditing] = useState(false);
  if (problem && !editing) setEditing(true);
  const open = editing || !!problem;

  const editRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    // Focus follows Edit and Done, not a problem opening the fields.
    if (open && editing)
      panelRef.current?.querySelector<HTMLInputElement>("input:enabled")?.focus();
    if (!open) editRef.current?.focus();
  }, [open, editing]);

  const discogsNote = discogs && <span className="muted"> · Discogs master {discogs}</span>;
  if (!open)
    return (
      <div className="single-summary">
        <span className="single-label">
          <i />
          Single
        </span>
        {QID.test(qid) ? (
          <span>
            Reusing <WikiLink base={wikiBaseUrl} qid={qid} />
            {found?.status === "ok" && found.label && (
              <>
                {" "}
                <b>{found.label}</b>
              </>
            )}
            {found?.status === "ok" && found.description && (
              <span className="muted"> · {found.description}</span>
            )}
            {found?.status === "loading" && <span className="muted"> · looking it up…</span>}
            {found?.status === "failed" && (
              <span className="muted"> · couldn’t look it up on Wikidata</span>
            )}
            {discogsNote}
          </span>
        ) : (
          <span>
            New single <span className="muted">· released {date}</span>
            {discogsNote}
          </span>
        )}
        <button
          ref={editRef}
          type="button"
          className="link"
          aria-label={`Edit single for track ${n}`}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>
    );
  return (
    <div className="single-panel" ref={panelRef}>
      <label className="f">
        <Pids>Release date (P577)</Pids>
        <input
          type="text"
          className="date"
          spellCheck={false}
          placeholder={qid ? "Not for an existing single" : "YYYY-MM-DD"}
          aria-invalid={date !== "" && !parseDate(date).ok}
          disabled={qid !== "" && date === ""}
          value={sg.date}
          onChange={(e) => update((s) => void (s.discs[di].single[n].date = e.target.value))}
          onBlur={(e) =>
            update((s) => void (s.discs[di].single[n].date = normalizeDate(e.target.value)))
          }
        />
      </label>
      <label className="f">
        Existing single
        <QidInput
          placeholder={date ? "Clear the date to reuse one" : "Q… to reuse one"}
          aria-invalid={(qid !== "" && !QID.test(qid)) || !!notSingle}
          disabled={date !== "" && qid === ""}
          value={sg.qid}
          onChange={(q) => update((s) => void (s.discs[di].single[n].qid = q.trim()))}
        />
      </label>
      <label className="f">
        <Pids>{`${DISCOGS_FIELD.label} (${DISCOGS_FIELD.property})`}</Pids>
        <input
          type="text"
          className="ext-id"
          spellCheck={false}
          placeholder="Optional, ID or URL"
          aria-invalid={discogs !== "" && !DISCOGS_FIELD.pattern.test(discogs)}
          value={sg.discogs}
          onChange={(e) =>
            update(
              (s) =>
                void (s.discs[di].single[n].discogs = normalizeAlbumId("discogs", e.target.value)),
            )
          }
        />
      </label>
      <button
        type="button"
        className="ghost small"
        aria-label={`Done editing single for track ${n}`}
        onClick={() => !problem && setEditing(false)}
      >
        Done
      </button>
      {/* Just ticked: say what to fill in rather than show an error. */}
      {qid === "" && date === "" && discogs === "" && (
        <p className="single-hint muted">Enter its release date, or an existing single's QID.</p>
      )}
      {problem && (qid !== "" || date !== "" || discogs !== "") && (
        <p className="field-err" aria-live="polite">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A warning icon on a track with possible matches to review, linked to them. */
/** Marks a row with identifiers from a MusicBrainz import, listing them on hover. */
function MbChip({ track, settings: S }: { track: Track; settings: Settings }) {
  const ids = track.mb;
  if (!ids) return null;
  const lines = [
    ...(S.mbIds
      ? [
          ids.recording && `Recording ID (P4404) ${ids.recording}`,
          ids.work && `Work ID (P435), for the composition, ${ids.work}`,
          ...ids.iswcs.map((v) => `ISWC (P1827), for the composition, ${v}`),
          ...ids.isrcs.map((v) => `ISRC (P1243) ${v}`),
          ...ids.spotify.map((v) => `Spotify track ID (P2207) ${v}`),
          ...ids.appleMusic.map((v) => `Apple Music track ID (P10110) ${v}`),
          ...ids.deezer.map((v) => `Deezer track ID (P2724) ${v}`),
          ...ids.tidal.map((v) => `Tidal track ID (P4578) ${v}`),
        ]
      : []),
    S.mbIds &&
      ids.source &&
      ids.isrcs.length +
        ids.iswcs.length +
        ids.spotify.length +
        ids.appleMusic.length +
        ids.deezer.length +
        ids.tidal.length >
        0 &&
      `A reference for the ISRCs, ISWCs and track IDs, stated in MusicBrainz`,
    ids.source && track.seconds !== null && `A reference for the duration, stated in MusicBrainz`,
  ].filter(Boolean);
  if (!lines.length) return null;
  const text = `From MusicBrainz, added if this row creates the item:\n${lines.join("\n")}`;
  return (
    <span className="chip" title={text} aria-label={text.replace(/\n/g, ". ")}>
      MB
    </span>
  );
}

function MatchFlag({ review }: { review: TrackReview }) {
  const n = review.candidates.length;
  const what = `${n} possible match${n === 1 ? "" : "es"}`;
  return (
    <a
      className="match-flag"
      href={`#${groupId(review.di, review.n)}`}
      aria-label={`Track ${review.n}: ${what} to review`}
      title={`${what}. Review under Possible matches`}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 1.5 15 14H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.75" r="0.9" fill="currentColor" />
      </svg>
    </a>
  );
}

type Lookup = (qid: string) => ItemLookup | undefined;

/**
 * Why an existing single's QID can't be used, or null if it's fine or still
 * being looked up.
 */
function singleProblem(qid: string, found: ItemLookup | undefined): string | null {
  if (found?.status === "missing") return `${qid} doesn't exist on Wikidata.`;
  if (found?.status === "redirect") return `${qid} redirects to ${found.to}. Use ${found.to}.`;
  if (found?.status === "ok" && !found.classes.includes(SINGLE_CLASS)) {
    const name = found.label ? `${qid} (${found.label})` : qid;
    return `${name} isn't an instance of single (${SINGLE_CLASS}).`;
  }
  return null;
}
