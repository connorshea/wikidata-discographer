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
  type SingleState,
  type Track,
} from "../lib/plan.ts";
import { artistsText, emptyDisc, parseArtists } from "../lib/state.ts";
import {
  addTrack,
  commonArtists,
  formatLength,
  insertTracks,
  lengthText,
  moveTrack,
  parseLength,
  pastedTracks,
  removeTrack,
  rowPerformers,
  type Renumbered,
} from "../lib/tracks.ts";
import { InfoTip, Pids, QidInput, WikiLink } from "./common.tsx";
import { ConfirmButton, ConfirmDialog } from "./ConfirmDialog.tsx";
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
  // Rows typed in, or added to an import, can be moved. A plain import is a release's
  // tracklist, so it keeps its order. Any row can be deleted.
  const manual = state.start !== "mb" || d.tracks.some((t) => !t.mb);
  const cols = manual ? 7 : 6;
  const setDisc = (fn: (disc: Disc) => void) => update((s) => fn(s.discs[di]));
  const ids = useId();
  const known = [...Object.keys(state.artists), ...albumArtists(state)];
  // The artists listed once above the table: the album's, as entered or imported, or else
  // those on every row. Rows list only who differs from them.
  const ofAlbum = (creating || state.start === "mb") && albumArtists(state).length > 0;
  const base = ofAlbum ? albumArtists(state) : commonArtists(rows);
  const linked = (name: string) => QID.test((state.artists[name] ?? "").trim());
  const featOf = (i: number) => (d.tracks[i].artists.length ? d.tracks[i].feat : undefined);
  const differs = rows.some((r, i) => {
    const p = rowPerformers({ artists: r.artists, feat: featOf(i) }, base);
    return p.only.length + p.with.length + p.feat.length > 0;
  });
  const linkedTo = (k: "comp" | "track", n: number) => QID.test((d[k][n] ?? "").trim());
  const mbOf = (i: number) =>
    mbFacts(d.tracks[i], state.settings, linkedTo("comp", rows[i].n), linkedTo("track", rows[i].n));
  const anyMb = rows.some((_, i) => mbOf(i));

  // A key for each row that follows it when rows move, so React moves the row's
  // inputs (and the focus in them) along with it.
  const [keys, setKeys] = useState(() => d.tracks.map(newKey));
  if (keys.length !== d.tracks.length)
    setKeys([...keys.slice(0, d.tracks.length), ...d.tracks.slice(keys.length).map(newKey)]);

  // The rows (by key) whose single's fields are open. They open when Single is ticked or
  // Edit is clicked, and stay open while something is wrong with them.
  const [singlesOpen, setSinglesOpen] = useState<ReadonlySet<number>>(new Set());
  const openSingle = (key: number, isOpen: boolean) =>
    setSinglesOpen((was) => {
      const next = new Set(was);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });
  const singleIssue = (n: number) => {
    const qid = d.single[n].qid.trim();
    return [
      plan.singleErrs[`${di}:${n}`],
      singleProblem(qid, QID.test(qid) ? lookup(qid) : undefined),
    ]
      .filter(Boolean)
      .join(" ");
  };
  const stuck = rows.findIndex(
    (r, i) => d.single[r.n] && !singlesOpen.has(keys[i]) && singleIssue(r.n),
  );
  if (stuck !== -1) setSinglesOpen(new Set([...singlesOpen, keys[stuck]]));

  // The row (by key) whose artists are open in a dialog.
  const [artistsOf, setArtistsOf] = useState<number | null>(null);
  const artistsAt = artistsOf === null ? -1 : keys.indexOf(artistsOf);
  // The MusicBrainz row (by key) waiting on a confirmation to delete it.
  const [deleting, setDeleting] = useState<number | null>(null);
  const deletingAt = deleting === null ? -1 : keys.indexOf(deleting);

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
    setFocusNext({ row: Math.min(i, d.tracks.length - 2), col: "menu" });
    setSaid(`Deleted track ${i + 1}${title ? `, ${title}` : ""}.`);
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
      {open.size > 0 && (
        <UnreviewedNotice count={open.size} href={`#${groupId(di, Math.min(...open.keys()))}`} />
      )}
      {rows.length > 0 && base.length > 0 && (
        <p className="album-line">
          <span>
            {ofAlbum ? (base.length > 1 ? "Album artists" : "Album artist") : "On every track"}
          </span>
          {base.map((a) => (
            <PerformerChip key={a} name={a} linked={linked(a)} />
          ))}
          <span className="muted">
            {differs
              ? "rows only list who differs"
              : "on every track, so only other performers are listed per row"}
          </span>
        </p>
      )}
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
                <th>
                  <span className="visually-hidden">Options</span>
                </th>
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
                const single = d.single[r.n];
                const singleOpen = !!single && singlesOpen.has(keys[i]);
                return (
                  <Fragment key={keys[i]}>
                    <tr
                      data-row={i}
                      className={cls(
                        singleOpen && "has-sub",
                        single && "is-single",
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
                          <MbBadge n={r.n} title={r.title} facts={mbOf(i)} />
                          {single && !singleOpen && (
                            <SinglePill
                              n={r.n}
                              single={single}
                              found={
                                QID.test(single.qid.trim()) ? lookup(single.qid.trim()) : undefined
                              }
                              onEdit={() => openSingle(keys[i], true)}
                            />
                          )}
                          <RowArtists
                            performers={rowPerformers(
                              { artists: r.artists, feat: featOf(i) },
                              base,
                            )}
                            prefixed={base.length > 0}
                            linked={linked}
                            error={t.title.trim() ? errs.artists : undefined}
                          />
                        </span>
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
                          checked={!!single}
                          onChange={(e) => {
                            const ticked = e.target.checked;
                            update((s) => {
                              const disc = s.discs[di];
                              if (ticked) disc.single[r.n] = { date: "", qid: "", discogs: "" };
                              else delete disc.single[r.n];
                            });
                            openSingle(keys[i], ticked);
                          }}
                        />
                      </td>
                      <td className="menu-col">
                        <RowMenu
                          label={`Track options for ${t.title.trim() || `track ${r.n}`}`}
                          items={[
                            {
                              label: t.artists.length ? "Edit artists" : "Add artists",
                              onSelect: () => setArtistsOf(keys[i]),
                            },
                            ...(manual && i > 0
                              ? [{ label: "Move up", onSelect: () => move(i, i - 1, "menu") }]
                              : []),
                            ...(manual && i < rows.length - 1
                              ? [{ label: "Move down", onSelect: () => move(i, i + 1, "menu") }]
                              : []),
                            {
                              label: "Delete track",
                              danger: true,
                              // A row from MusicBrainz can't be typed back in as easily.
                              onSelect: () => (t.mb ? setDeleting(keys[i]) : remove(i)),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                    {singleOpen && (
                      <tr className="sub-row is-single">
                        <td colSpan={manual ? 2 : 1} />
                        <td colSpan={cols - (manual ? 2 : 1)}>
                          <SinglePanel
                            di={di}
                            n={r.n}
                            title={r.title}
                            issue={singleIssue(r.n)}
                            found={
                              QID.test(single.qid.trim()) ? lookup(single.qid.trim()) : undefined
                            }
                            onDone={() => {
                              openSingle(keys[i], false);
                              setFocusNext({ row: i, col: "single-edit" });
                            }}
                            {...{ state, update }}
                          />
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
      {artistsAt !== -1 && (
        <ArtistsDialog
          n={rows[artistsAt].n}
          title={d.tracks[artistsAt].title}
          track={d.tracks[artistsAt]}
          linked={linked}
          known={known}
          placeholder={creating ? "Album artist" : "Artists"}
          onCommit={(names) =>
            setDisc((disc) => {
              const row = disc.tracks[artistsAt];
              row.artists = names.artists;
              if (names.feat) row.feat = names.feat;
              else delete row.feat;
            })
          }
          onClose={() => {
            setArtistsOf(null);
            setFocusNext({ row: artistsAt, col: "menu" });
          }}
        />
      )}
      <ConfirmDialog
        confirm={
          deletingAt === -1
            ? null
            : {
                title: `Delete track ${rows[deletingAt].n}, “${d.tracks[deletingAt].title.trim()}”?`,
                body: "It came from MusicBrainz, along with its length and identifiers.",
                action: "Delete track",
              }
        }
        onConfirm={() => {
          setDeleting(null);
          remove(deletingAt);
        }}
        onClose={() => {
          if (deletingAt !== -1) setFocusNext({ row: deletingAt, col: "menu" });
          setDeleting(null);
        }}
      />
      {rows.length > 0 && (base.length > 0 || anyMb) && (
        <p className="table-note">
          {base.length > 0 &&
            (differs
              ? `Only performers that differ from ${ofAlbum ? (base.length > 1 ? "the album artists" : "the album artist") : "those on every track"} are listed on their rows. `
              : ofAlbum
                ? `All performers here are ${base.length > 1 ? "the album artists" : "the album artist"}, so they're not repeated per row. `
                : "Every track has the same performers, so they're listed once above the table. ")}
          {anyMb && (
            <>
              Click the <span className="mb-badge">MB</span> badge to see its MusicBrainz
              identifiers.
            </>
          )}
        </p>
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

/** Scroll to a performer's row in Performers and focus its QID. False if it isn't there. */
function goToPerformer(name: string): boolean {
  const row = [...document.querySelectorAll<HTMLElement>("#performers [data-performer]")].find(
    (el) => el.dataset.performer === name,
  );
  const input = row?.querySelector<HTMLInputElement>("input");
  if (!row || !input) return false;
  row.scrollIntoView({ block: "center" });
  input.focus({ preventScroll: true });
  return true;
}

/** An artist, with a green dot once it's linked to a QID. It goes to the artist in Performers. */
function PerformerChip({ name, linked }: { name: string; linked: boolean }) {
  return (
    <a
      className={cls("who-chip", !linked && "todo")}
      href="#performers"
      onClick={(e) => {
        if (goToPerformer(name)) e.preventDefault();
      }}
    >
      <i aria-hidden="true" />
      {name}
      {linked ? <span className="visually-hidden">, linked</span> : " · needs QID"}
    </a>
  );
}

/**
 * Who a row credits beyond the artists above the table, as chips. Its menu's
 * Edit artists opens a dialog to change them.
 */
function RowArtists({
  performers: p,
  prefixed,
  linked,
  error,
}: {
  performers: ReturnType<typeof rowPerformers>;
  /** Whether there are artists above the table that the chips differ from. */
  prefixed: boolean;
  linked: (name: string) => boolean;
  error?: string;
}) {
  const id = useId();
  const chips = (names: string[]) =>
    names.map((a) => <PerformerChip key={a} name={a} linked={linked(a)} />);
  const groups = [
    p.only.length > 0 && (["Only", p.only] as const),
    p.with.length > 0 && ([prefixed ? "With" : "", p.with] as const),
    p.feat.length > 0 && (["feat.", p.feat] as const),
  ].filter((g) => g !== false);
  return (
    (groups.length > 0 || error) && (
      <span className="who">
        {groups.map(([label, names], g) => (
          <Fragment key={label}>
            {(label || g > 0) && (
              <span className={g > 0 ? "who-sep" : undefined}>
                {g > 0 ? ", " : ""}
                {label}
              </span>
            )}
            {chips(names)}
          </Fragment>
        ))}
        {error && <CellErr id={`${id}-err`}>{error}</CellErr>}
      </span>
    )
  );
}

interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * A row's actions behind a "⋯" button. Arrow keys, Home and End move through
 * them, and Escape, Tab or a click outside closes the menu. An item's action
 * moves the focus itself, to a dialog or back to a row.
 */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const entries = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Placed under the button, or over it when there's no room below, with their right
  // edges lined up. It's fixed so the table's scrolling box doesn't clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const el = menu.current;
      if (!b || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = b.bottom + 4;
      const top = below + h > window.innerHeight && b.top - h - 4 > 0 ? b.top - h - 4 : below;
      el.style.left = `${Math.max(8, Math.min(b.right - w, window.innerWidth - w - 8))}px`;
      el.style.top = `${top}px`;
    };
    place();
    entries()[0]?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="row-menu-button"
        data-col="menu"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {[3, 8, 13].map((x) => (
            <circle key={x} cx={x} cy="8" r="1.5" />
          ))}
        </svg>
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          className="row-menu"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const all = entries();
            const at = all.indexOf(document.activeElement as HTMLElement);
            const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
            if (to !== undefined) all[(to + all.length) % all.length]?.focus();
            else if (e.key !== "Escape" && e.key !== "Tab") return;
            else close(true);
            e.preventDefault();
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? "danger" : undefined}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * A modal dialog that edits a row's artists as "A, B feat. C", showing the
 * names as they'll be read. Done or Enter keeps them, and Cancel, Escape or a
 * click on the backdrop drops what was typed. It opens when it mounts, and
 * `onClose` should unmount it.
 */
function ArtistsDialog({
  n,
  title,
  track,
  linked,
  known,
  placeholder,
  onCommit,
  onClose,
}: {
  n: number;
  title: string;
  track: Track;
  linked: (name: string) => boolean;
  known: string[];
  placeholder: string;
  onCommit: (names: Pick<Track, "artists" | "feat">) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const text = artistsText(track);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    input.current?.select();
  }, []);
  const close = () => dialog.current?.close();
  const parsed = parseArtists(draft, known);
  const feat = new Set(parsed.feat);
  return (
    <dialog
      ref={dialog}
      className="confirm add-item artists-dialog"
      aria-labelledby={`${ids}-title`}
      onClose={onClose}
      // As in ConfirmDialog: a click on the backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <form
        className="confirm-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft !== text) onCommit(parsed);
          close();
        }}
      >
        <div className="add-item-head">
          <h2 id={`${ids}-title`}>Artists · {title.trim() || `Track ${n}`}</h2>
          <button type="button" className="add-item-x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <label className="f">
          Artists
          <input
            ref={input}
            type="text"
            data-col="artists"
            aria-describedby={`${ids}-hint`}
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <p id={`${ids}-hint`}>Separate names with commas, and put featured artists after "feat."</p>
        {parsed.artists.length > 0 && (
          <ul className="artists-preview" aria-label="Read as">
            {parsed.artists.map((a) => (
              <li key={a} className={cls("who-chip", !linked(a) && "todo")}>
                <i aria-hidden="true" />
                {feat.has(a) && <span className="muted">feat.</span>}
                {a}
                {linked(a) ? <span className="visually-hidden">, linked</span> : " · needs QID"}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit">Done</button>
        </div>
      </form>
    </dialog>
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

/** A track's single once its fields are done: "Single · date", or the single it reuses, and Edit. */
function SinglePill({
  n,
  single: sg,
  found,
  onEdit,
}: {
  n: number;
  single: SingleState;
  found: ItemLookup | undefined;
  onEdit: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const qid = sg.qid.trim();
  return (
    <span className="single-pill">
      <i aria-hidden="true" />
      {QID.test(qid) ? (
        <span>
          Single · <WikiLink base={wikiBaseUrl} qid={qid} />
          {found?.status === "ok" && found.label && ` ${found.label}`}
          {found?.status === "loading" && <span className="muted"> · looking it up…</span>}
          {found?.status === "failed" && (
            <span className="muted"> · couldn’t look it up on Wikidata</span>
          )}
        </span>
      ) : (
        <span>Single · {sg.date.trim()}</span>
      )}
      <button
        type="button"
        className="link"
        data-col="single-edit"
        aria-label={`Edit single for track ${n}`}
        onClick={onEdit}
      >
        Edit
      </button>
    </span>
  );
}

/**
 * A track's single's fields, on their own row under the track: a release
 * date for a new single or an existing single's QID, and its Discogs master
 * ID. Done only closes them once nothing is wrong with them.
 */
function SinglePanel({
  di,
  n,
  title,
  issue,
  found,
  onDone,
  state,
  update,
}: Pick<SectionProps, "state" | "update"> & {
  di: number;
  n: number;
  title: string;
  /** What's wrong with the fields, or "". */
  issue: string;
  found: ItemLookup | undefined;
  onDone: () => void;
}) {
  const sg = state.discs[di].single[n];
  const qid = sg.qid.trim();
  const date = sg.date.trim();
  const discogs = sg.discogs.trim();
  const ids = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>("input:enabled")?.focus();
  }, []);
  const blank = qid === "" && date === "" && discogs === "";
  const existing = QID.test(qid);

  return (
    <div className="single-panel" ref={panel}>
      <div className="single-head">
        <span className="sw" aria-hidden="true" />
        {existing ? (
          <span>
            Existing single{found?.status === "ok" && found.label ? ` · ${found.label}` : ""}
          </span>
        ) : (
          <span>New single{title ? ` · ${title}` : ""}</span>
        )}
        <span className="muted">· lists this track, taken from the album</span>
      </div>
      <div className="single-fields">
        <label className="f">
          Release date
          <input
            type="text"
            spellCheck={false}
            placeholder={qid ? "Not for an existing single" : "YYYY-MM-DD"}
            aria-invalid={date !== "" && !parseDate(date).ok}
            aria-describedby={issue && !blank ? `${ids}-err` : undefined}
            disabled={qid !== "" && date === ""}
            value={sg.date}
            onChange={(e) => update((s) => void (s.discs[di].single[n].date = e.target.value))}
            onBlur={(e) =>
              update((s) => void (s.discs[di].single[n].date = normalizeDate(e.target.value)))
            }
          />
        </label>
        <label className="f">
          Or an existing single
          <QidInput
            className="qid"
            placeholder={date ? "Clear the date to reuse one" : "Q… to reuse one"}
            aria-invalid={(qid !== "" && !QID.test(qid)) || found?.status === "missing"}
            aria-describedby={issue && !blank ? `${ids}-err` : undefined}
            disabled={date !== "" && qid === ""}
            value={sg.qid}
            onChange={(q) => update((s) => void (s.discs[di].single[n].qid = q.trim()))}
          />
        </label>
        <label className="f">
          {DISCOGS_FIELD.label}
          <input
            type="text"
            spellCheck={false}
            placeholder="Optional, ID or URL"
            aria-invalid={discogs !== "" && !DISCOGS_FIELD.pattern.test(discogs)}
            value={sg.discogs}
            onChange={(e) =>
              update(
                (s) =>
                  void (s.discs[di].single[n].discogs = normalizeAlbumId(
                    "discogs",
                    e.target.value,
                  )),
              )
            }
          />
        </label>
      </div>
      {/* Just ticked: say what to fill in rather than show an error. */}
      {blank && (
        <p className="single-hint muted">Enter its release date, or an existing single's QID.</p>
      )}
      {issue && !blank && (
        <p className="field-err" id={`${ids}-err`} aria-live="polite">
          {issue}
        </p>
      )}
      <div className="single-foot">
        <span className="single-note">
          {!existing && "Uses the track's title and artists."}
          <span className="warn-note">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M7 3.8v3.6M7 9.6v.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Singles can only have one track for now.
          </span>
        </span>
        <button
          type="button"
          className="ghost small"
          aria-label={`Done editing single for track ${n}`}
          aria-disabled={!!issue}
          onClick={() => !issue && onDone()}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** What a row's MB badge lists: its imported values, for the track and for the composition. */
interface MbFacts {
  track: [string, string][];
  comp: [string, string][];
  /** Why a section adds nothing: the row links an existing item. */
  linked: { track: boolean; comp: boolean };
  /** Whether the values get a MusicBrainz reference. */
  cited: boolean;
  recording: string;
}

/**
 * The MusicBrainz values a row adds if it creates its track and composition,
 * or null when the import gave it none. `raw` is the row as stored, with the
 * length as imported.
 */
function mbFacts(
  raw: Track,
  S: Settings,
  linkedComp: boolean,
  linkedTrack: boolean,
): MbFacts | null {
  const ids = raw.mb;
  if (!ids) return null;
  const many = (label: string, vs: string[]) => vs.map((v): [string, string] => [label, v]);
  const track: [string, string][] = [
    ...(S.mbIds && ids.recording ? [["Recording ID", ids.recording] as [string, string]] : []),
    ...(S.mbIds ? many("ISRC", ids.isrcs) : []),
    ...(raw.seconds !== null ? [["Duration", durationNote(raw)] as [string, string]] : []),
    ...(S.mbIds
      ? [
          ...many("Spotify", ids.spotify),
          ...many("Apple Music", ids.appleMusic),
          ...many("Deezer", ids.deezer),
          ...many("Tidal", ids.tidal),
        ]
      : []),
  ];
  const comp: [string, string][] = S.mbIds
    ? [...(ids.work ? [["Work ID", ids.work] as [string, string]] : []), ...many("ISWC", ids.iswcs)]
    : [];
  if (!track.length && !comp.length) return null;
  return {
    track,
    comp,
    linked: { track: linkedTrack, comp: linkedComp },
    cited: !!ids.source,
    recording: ids.recording || ids.source?.recording || "",
  };
}

/** The imported duration, and whether the tracklist still has it. */
function durationNote(raw: Track): string {
  const mb = formatLength(raw.seconds);
  if (raw.length === undefined) return `${mb}, matches the tracklist`;
  const typed = parseLength(raw.length);
  if (!typed.ok) return `${mb}. The length typed in the tracklist is used instead, once it's valid`;
  if (typed.seconds === null) return `${mb}. The tracklist's length was cleared, so none is added`;
  return `${mb}. The tracklist's ${formatLength(typed.seconds)} is used instead, without a reference`;
}

/**
 * A row's MB badge: a button that opens what the import adds to the row's
 * items. Escape, a click outside or moving focus out closes it.
 */
function MbBadge({ n, title, facts }: { n: number; title: string; facts: MbFacts | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Placed under the badge, or over it when there's no room below, inside the window. It's
  // fixed so the table's scrolling box doesn't clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = button.current?.getBoundingClientRect();
      const el = dialog.current;
      if (!b || !el) return;
      const w = Math.min(400, window.innerWidth - 32);
      const h = el.offsetHeight;
      const below = b.bottom + 6;
      const top = below + h > window.innerHeight && b.top - h - 6 > 0 ? b.top - h - 6 : below;
      el.style.width = `${w}px`;
      el.style.left = `${Math.max(16, Math.min(b.left, window.innerWidth - w - 16))}px`;
      el.style.top = `${top}px`;
    };
    place();
    dialog.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!dialog.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!facts) return null;
  const section = (
    kind: "track" | "comp",
    name: string,
    rows: [string, string][],
    linkedNote: string,
  ) =>
    rows.length > 0 && (
      <div className="mb-pop-section">
        <h4>
          <span className={`sw ${kind}`} aria-hidden="true" />
          {name}
        </h4>
        {facts.linked[kind] ? (
          <p className="muted">{linkedNote}</p>
        ) : (
          <dl className="kv">
            {rows.map(([k, v], i) => (
              <Fragment key={i}>
                <dt>{k}</dt>
                <dd className={k === "Duration" ? undefined : "mono"}>{v}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  return (
    <>
      <button
        ref={button}
        type="button"
        className="mb-badge mb-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        aria-label={`MusicBrainz data for track ${n}`}
        onClick={() => setOpen(!open)}
      >
        MB
      </button>
      {open && (
        <div
          ref={dialog}
          id={`${id}-pop`}
          className="mb-pop"
          role="dialog"
          aria-labelledby={`${id}-head`}
          tabIndex={-1}
        >
          <div className="mb-pop-head">
            <span className="mb-badge" aria-hidden="true">
              MB
            </span>
            <div>
              <b id={`${id}-head`}>
                From MusicBrainz
                <span className="visually-hidden">, {title || `track ${n}`}</span>
              </b>
              <span className="muted">Added only if this row creates the item</span>
            </div>
            <button type="button" className="rm" aria-label="Close" onClick={() => close(true)}>
              ×
            </button>
          </div>
          {section(
            "track",
            "Track",
            facts.track,
            "This row links an existing track, so these aren't added.",
          )}
          {section(
            "comp",
            "Composition",
            facts.comp,
            "This row links an existing composition, so these aren't added.",
          )}
          <div className="mb-pop-foot">
            <span className="muted">
              {facts.cited ? "Referenced as stated in MusicBrainz" : ""}
            </span>
            {facts.recording && (
              <a
                href={`https://musicbrainz.org/recording/${facts.recording}`}
                target="_blank"
                rel="noreferrer"
              >
                Open recording ↗
              </a>
            )}
          </div>
        </div>
      )}
    </>
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
      <span aria-hidden="true" />
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
