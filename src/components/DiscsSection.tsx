import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import {
  groupId,
  removedDisc,
  renumberedRows,
  type RowMove,
  type TrackReview,
} from "../lib/matches.ts";
import {
  albumArtists,
  isCustomPart,
  isCustomTrackLang,
  LANGS,
  NO_LINGUISTIC_CONTENT,
  normalizeDate,
  normalizeQid,
  PARTS,
  parseDate,
  partLabel,
  QID,
  TRACK_TYPES,
  REC_TYPES,
  recTypeName,
  trackLangOf,
  trackRecordedOf,
  trackRecTypesOf,
  trackTypeOf,
  WITHOUT_LYRICS,
  type Disc,
  type Plan,
  type RowErrs,
  type Settings,
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
import { formatTime } from "../lib/preview.ts";
import { FieldErr, Lock, Pids, QidInput, WikiLink } from "./common.tsx";
import { ConfirmButton, ConfirmDialog } from "./ConfirmDialog.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import type { SectionProps } from "./types.ts";

const cls = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

let lastKey = 0;
/** A new key for a row, unique on the page. */
const newKey = () => ++lastKey;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whether a disc has a problem to fix in its part, or in one of its rows. */
const discHasErrors = (plan: Plan, di: number) =>
  !!plan.fieldErrs[`part-${di}`] || Object.keys(plan.rowErrs).some((k) => k.startsWith(`${di}:`));

/**
 * The artists listed once above the cards: the album's, as entered or imported, or else
 * those on every row. Cards list only who differs from them.
 */
function baseArtists(state: SectionProps["state"], rows: Parameters<typeof commonArtists>[0]) {
  const ofAlbum =
    (state.album.mode === "create" || state.start === "mb") && albumArtists(state).length > 0;
  return { ofAlbum, base: ofAlbum ? albumArtists(state) : commonArtists(rows) };
}

export default function DiscsSection({
  state,
  update,
  plan,
  reviews,
  onRowsMoved,
}: SectionProps & {
  reviews: TrackReview[];
  /** Rows were renumbered or a disc removed, so whatever's kept by disc and track number should follow. */
  onRowsMoved: (move: RowMove) => void;
}) {
  const [tab, setTab] = useState(0);
  const di = Math.min(tab, state.discs.length - 1);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabsId = useId();
  const pick = (i: number, focus = false) => {
    setTab(i);
    if (focus) tabs.current[i]?.focus();
  };
  const rows = plan.tracks[di] ?? [];
  const { ofAlbum, base } = baseArtists(state, rows);
  return (
    <section className="block" id="tracks">
      <div className="album-head tracks-head">
        <h2>
          <span className="sw" style={{ background: "var(--trk-edge)" }} aria-hidden="true" />
          Tracks
        </h2>
        {rows.length > 0 && base.length > 0 && (
          <p className="album-line">
            <span>
              {ofAlbum ? (base.length > 1 ? "Album artists" : "Album artist") : "On every track"}
            </span>
            {base.map((a) => (
              <PerformerChip key={a} name={a} linked={QID.test((state.artists[a] ?? "").trim())} />
            ))}
          </p>
        )}
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
        <Lock>
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
        </Lock>
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${di}`}>
        <Lock>
          <DiscBlock
            key={di}
            di={di}
            reviews={reviews.filter((r) => r.di === di)}
            onRenumber={(moved) => onRowsMoved(renumberedRows(di, moved))}
            onRemove={() => {
              update((s) => void s.discs.splice(di, 1));
              onRowsMoved(removedDisc(di));
              pick(Math.max(0, di - 1), true);
            }}
            {...{ state, update, plan }}
          />
        </Lock>
      </div>
    </section>
  );
}

/** An element of a card: its column and the row's index. */
type CellAt = { row: number; col: string };

/** What a click on a closed card does itself, rather than open the card. */
const INTERACTIVE = "a, button, input, select, label, [role='menu'], [role='dialog']";

function DiscBlock({
  di,
  reviews,
  onRenumber,
  onRemove,
  state,
  update,
  plan,
}: SectionProps & {
  di: number;
  reviews: TrackReview[];
  onRenumber: (moved: Renumbered) => void;
  onRemove: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const d = state.discs[di];
  const rows = plan.tracks[di] ?? [];
  const open = new Map(reviews.filter((r) => !r.reviewed).map((r) => [r.n, r]));
  const custom = isCustomPart(d);
  const creating = state.album.mode === "create";
  // Rows typed in, or added to an import, can be moved. A plain import is a release's
  // tracklist, so it keeps its order. Any row can be deleted.
  const manual = state.start !== "mb" || d.tracks.some((t) => !t.mb);
  const setDisc = (fn: (disc: Disc) => void) => update((s) => fn(s.discs[di]));
  const ids = useId();
  const partErr = plan.fieldErrs[`part-${di}`];
  const known = [...Object.keys(state.artists), ...albumArtists(state)];
  const { ofAlbum, base } = baseArtists(state, rows);
  const linked = (name: string) => QID.test((state.artists[name] ?? "").trim());
  const featOf = (i: number) => (d.tracks[i].artists.length ? d.tracks[i].feat : undefined);
  const linkedTo = (k: "comp" | "track", n: number) => QID.test((d[k][n] ?? "").trim());
  const mbOf = (i: number) =>
    mbFacts(
      d.tracks[i],
      linkedTo("comp", rows[i].n),
      linkedTo("track", rows[i].n),
      state.settings.mbWriters,
    );

  // A key for each row that follows it when rows move, so React moves the row's
  // inputs (and the focus in them) along with it.
  const [keys, setKeys] = useState(() => d.tracks.map(newKey));
  if (keys.length !== d.tracks.length)
    setKeys([...keys.slice(0, d.tracks.length), ...d.tracks.slice(keys.length).map(newKey)]);

  // The cards (by key) open to edit.
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const setOpen = (key: number, isOpen: boolean) =>
    setOpened((was) => {
      const next = new Set(was);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });

  // The MusicBrainz row (by key) waiting on a confirmation to delete it.
  const [deleting, setDeleting] = useState<number | null>(null);
  const deletingAt = deleting === null ? -1 : keys.indexOf(deleting);

  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The element to focus once the rows have changed.
  const focusNext = useRef<CellAt | null>(null);
  const setFocusNext = (at: CellAt) => void (focusNext.current = at);
  const [said, setSaid] = useState("");
  useLayoutEffect(() => {
    const at = focusNext.current;
    if (!at) return;
    focusNext.current = null;
    const el = list.current?.querySelector<HTMLElement>(
      `[data-row="${at.row}"] [data-col="${at.col}"]`,
    );
    (el ?? addButton.current)?.focus();
  });

  const openCard = (i: number) => {
    setOpen(keys[i], true);
    setFocusNext({ row: i, col: "title" });
  };
  /** Close a card, once the field in it that has the focus has kept what was typed. */
  const closeCard = (i: number) => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && list.current?.querySelector(`[data-row="${i}"]`)?.contains(el))
      el.blur();
    setOpen(keys[i], false);
    setFocusNext({ row: i, col: "edit" });
  };

  /** Change the rows' order or number, then tell whatever keeps rows by number. */
  const reorder = (fn: (disc: Disc) => Renumbered) => {
    const next = structuredClone(d);
    const moved = fn(next);
    setDisc((disc) => Object.assign(disc, structuredClone(next)));
    onRenumber(moved);
  };
  /** Add a row at the end, open to type in. */
  const add = () => {
    const key = newKey();
    setKeys((ks) => [...ks, key]);
    setDisc(addTrack);
    setOpen(key, true);
    setFocusNext({ row: d.tracks.length, col: "title" });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= d.tracks.length || to === from) return;
    setKeys((ks) => {
      const next = [...ks];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
    reorder((disc) => moveTrack(disc, from, to));
    setFocusNext({ row: to, col: "menu" });
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

  return (
    <div className="disc-panel">
      <div className="disc-bar">
        <label className="f">
          <Pids>Part (P518 on the tracklist)</Pids>
          <select
            value={custom ? "other" : d.part}
            aria-invalid={!custom && !!partErr}
            aria-describedby={`${ids}-part-err`}
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
              aria-invalid={!!partErr}
              aria-describedby={`${ids}-part-err`}
              value={d.part}
              onChange={(e) => setDisc((disc) => void (disc.part = normalizeQid(e.target.value)))}
            />
          )}
          <FieldErr id={`${ids}-part`} msg={partErr} />
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
                    body: `This removes its ${plural(d.tracks.length, "track")}, and the items linked to them. It can't be undone.`,
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
      {rows.length > 0 && (
        <ol className="trk-list" ref={list} aria-label={`Disc ${di + 1} tracks`}>
          {rows.map((r, i) => {
            const t = d.tracks[i];
            const errs: RowErrs = plan.rowErrs[`${di}:${r.n}`] ?? {};
            const title = t.title.trim();
            const review = open.get(r.n);
            const isOpen = opened.has(keys[i]);
            const performers = rowPerformers({ artists: r.artists, feat: featOf(i) }, base);
            const issues = [
              errs.title,
              errs.length,
              title ? errs.artists : undefined,
              errs.comp,
              errs.track,
              errs.lang,
              errs.recorded,
            ].filter((e): e is string => !!e);
            // A row from MusicBrainz can't be typed back in as easily.
            const del = () => (t.mb ? setDeleting(keys[i]) : remove(i));
            return (
              <li
                key={keys[i]}
                data-row={i}
                className={cls("trk", isOpen && "open", !isOpen && issues.length > 0 && "has-err")}
                onClick={(e) => {
                  if (!isOpen && !(e.target as HTMLElement).closest(INTERACTIVE)) openCard(i);
                }}
                onKeyDown={(e) => {
                  if (!isOpen || e.defaultPrevented || e.nativeEvent.isComposing) return;
                  const typing = e.target instanceof HTMLInputElement && e.target.type === "text";
                  if (e.key !== "Escape" && !(e.key === "Enter" && typing)) return;
                  e.preventDefault();
                  closeCard(i);
                }}
              >
                <span className="num">{r.n}</span>
                {isOpen ? (
                  <>
                    <span className="trk-title-edit">
                      <Cell
                        data-col="title"
                        label={`Track ${r.n} title`}
                        placeholder="Title"
                        value={t.title}
                        error={errs.title}
                        onChange={(v) => setDisc((disc) => void (disc.tracks[i].title = v))}
                        onPaste={(e) => {
                          if (paste(i, e.clipboardData.getData("text"))) e.preventDefault();
                        }}
                      />
                    </span>
                    <span className="trk-side">
                      <MbBadge n={r.n} title={r.title} facts={mbOf(i)} />
                      <button type="button" className="trk-done" onClick={() => closeCard(i)}>
                        Done
                      </button>
                    </span>
                    <div className="trk-fields">
                      <label className="f">
                        Length
                        <Cell
                          data-col="length"
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
                        {t.mb && t.seconds !== null && (
                          <span className="sub with-badge">
                            <span className="mb-badge">MB</span>
                            {t.length === undefined
                              ? "Matches MusicBrainz"
                              : `MusicBrainz has ${formatLength(t.seconds)}`}
                          </span>
                        )}
                      </label>
                      <ArtistsField
                        n={r.n}
                        track={t}
                        known={known}
                        linked={linked}
                        placeholder={
                          ofAlbum
                            ? `${base.join(", ")} (default for album)`
                            : creating
                              ? "Album artist"
                              : "Artists"
                        }
                        error={title ? errs.artists : undefined}
                        onCommit={(names) =>
                          setDisc((disc) => {
                            const row = disc.tracks[i];
                            row.artists = names.artists;
                            if (names.feat) row.feat = names.feat;
                            else delete row.feat;
                          })
                        }
                      />
                      <TrackType
                        n={r.n}
                        track={t}
                        settings={state.settings}
                        linkedTrack={linkedTo("track", r.n)}
                        onChange={(type) =>
                          setDisc((disc) => {
                            const row = disc.tracks[i];
                            if (type) row.type = type;
                            else delete row.type;
                          })
                        }
                      />
                      <TrackLang
                        n={r.n}
                        track={t}
                        settings={state.settings}
                        linkedComp={linkedTo("comp", r.n)}
                        error={errs.lang}
                        onChange={(lang, custom) =>
                          setDisc((disc) => {
                            const row = disc.tracks[i];
                            if (lang === undefined) delete row.p407;
                            else row.p407 = lang;
                            if (custom) row.p407Custom = true;
                            else delete row.p407Custom;
                          })
                        }
                      />
                      <Recorded
                        n={r.n}
                        track={t}
                        settings={state.settings}
                        linkedTrack={linkedTo("track", r.n)}
                        error={errs.recorded}
                        onChange={(v) =>
                          setDisc((disc) => {
                            const row = disc.tracks[i];
                            if (v.trim()) row.recorded = v;
                            else delete row.recorded;
                          })
                        }
                      />
                      <RecTypes
                        n={r.n}
                        track={t}
                        settings={state.settings}
                        linkedTrack={linkedTo("track", r.n)}
                        onChange={(qids) =>
                          setDisc((disc) => {
                            const row = disc.tracks[i];
                            if (qids) row.recTypes = qids;
                            else delete row.recTypes;
                          })
                        }
                      />
                      {state.settings.mbWriters && (
                        <Writers track={t} linkedComp={linkedTo("comp", r.n)} linked={linked} />
                      )}
                      <LinkFields
                        di={di}
                        n={r.n}
                        errs={errs}
                        disc={d}
                        review={review}
                        setDisc={setDisc}
                      />
                      <div className="trk-foot">
                        {/* As the closed card's menu is, so the focus can come back here. */}
                        <button type="button" className="link danger" data-col="menu" onClick={del}>
                          Delete track
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="trk-title"
                      data-col="edit"
                      aria-label={`Edit track ${r.n}${title ? `, ${title}` : ""}`}
                      onClick={() => openCard(i)}
                    >
                      {title || <span className="muted">No title</span>}
                    </button>
                    <span className="trk-side">
                      {lengthText(t) && <span>{lengthText(t)}</span>}
                      <MbBadge n={r.n} title={r.title} facts={mbOf(i)} />
                      <RowMenu
                        label={`Track options for ${title || `track ${r.n}`}`}
                        items={[
                          { label: "Edit track", onSelect: () => openCard(i) },
                          ...(manual && i > 0
                            ? [{ label: "Move up", onSelect: () => move(i, i - 1) }]
                            : []),
                          ...(manual && i < rows.length - 1
                            ? [{ label: "Move down", onSelect: () => move(i, i + 1) }]
                            : []),
                          { label: "Delete track", danger: true, onSelect: del },
                        ]}
                      />
                    </span>
                    <TrackFacts
                      facts={[
                        ...(["comp", "track"] as const)
                          .filter((k) => linkedTo(k, r.n))
                          .map((k) => (
                            <span key={k} className={`link-chip ${k}`}>
                              <i aria-hidden="true" />
                              {k === "comp" ? "Composition" : "Track"}{" "}
                              <WikiLink base={wikiBaseUrl} qid={d[k][r.n].trim()} />
                            </span>
                          )),
                        !linkedTo("track", r.n) && typeTag(t, state.settings),
                        !linkedTo("comp", r.n) && langTag(t, state.settings),
                        recTypesFact(t, state.settings),
                        recordedFact(t, state.settings),
                        hasPerformers(performers) && (
                          <RowArtists
                            key="who"
                            performers={performers}
                            prefixed={base.length > 0}
                            linked={linked}
                          />
                        ),
                        review && (
                          <a key="match" className="match-tag" href={`#${groupId(di, r.n)}`}>
                            {plural(review.candidates.length, "possible match", "possible matches")}{" "}
                            · review ↓
                          </a>
                        ),
                      ]}
                      issues={issues}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ol>
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
      <div className="add-track">
        <button ref={addButton} type="button" className="ghost" onClick={add}>
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
      </div>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/**
 * A closed card's line under its title: what it links, who it credits beyond the
 * artists above and its matches, then what's wrong with it.
 */
function TrackFacts({ facts, issues }: { facts: React.ReactNode[]; issues: string[] }) {
  const id = useId();
  const shown = facts.filter(Boolean);
  if (!shown.length && !issues.length) return null;
  return (
    <span className="trk-facts">
      {shown.map((f, k) => (
        <Fragment key={k}>
          {k > 0 && (
            <span className="sep" aria-hidden="true">
              ·
            </span>
          )}
          {f}
        </Fragment>
      ))}
      {issues.map((msg, k) => (
        <CellErr key={k} id={`${id}-${k}`}>
          {msg}
        </CellErr>
      ))}
    </span>
  );
}

/**
 * A row's artists, typed as "A, B feat. C", with the names as they'll be read
 * under it. They're kept once the field is left.
 */
function ArtistsField({
  n,
  track,
  known,
  linked,
  placeholder,
  error,
  onCommit,
}: {
  n: number;
  track: Track;
  known: string[];
  linked: (name: string) => boolean;
  placeholder: string;
  error?: string;
  onCommit: (names: Pick<Track, "artists" | "feat">) => void;
}) {
  const ids = useId();
  const text = artistsText(track);
  // What's typed, until the field is left.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = parseArtists(draft ?? text, known);
  const feat = new Set(parsed.feat);
  return (
    <div className="f">
      <label htmlFor={`${ids}-in`}>Artists</label>
      <input
        id={`${ids}-in`}
        type="text"
        data-col="artists"
        aria-describedby={`${ids}-hint${error ? ` ${ids}-err` : ""}`}
        aria-invalid={!!error}
        placeholder={placeholder}
        value={draft ?? text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== text) onCommit(parsed);
          setDraft(null);
        }}
      />
      <span className="sub" id={`${ids}-hint`}>
        Separate names with commas, and put featured artists after "feat."
      </span>
      {parsed.artists.length > 0 && (
        <ul className="artists-preview" aria-label={`Track ${n} artists read as`}>
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
      {error && <CellErr id={`${ids}-err`}>{error}</CellErr>}
    </div>
  );
}

/**
 * The composers and lyricists a MusicBrainz import found for a row's composition, as
 * chips that go to the writer in People. Nothing for a row without any.
 */
function Writers({
  track,
  linkedComp,
  linked,
}: {
  track: Track;
  linkedComp: boolean;
  linked: (name: string) => boolean;
}) {
  const groups = [
    ["Composers", track.mb?.composers ?? []],
    ["Lyricists", track.mb?.lyricists ?? []],
  ] as const;
  if (groups.every(([, ws]) => !ws.length)) return null;
  const note = !linkedComp
    ? "Added to the new composition. Writers that aren't linked in People are left off."
    : "The linked composition only gets the ones it doesn't have yet.";
  return (
    <div className="f wide">
      <span className="with-badge">
        Composers and lyricists <span className="mb-badge">MB</span>
      </span>
      <dl className="writers">
        {groups.map(
          ([label, ws]) =>
            ws.length > 0 && (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>
                  {ws.map((w) => (
                    <PerformerChip key={w.id} name={w.name} linked={linked(w.name)} optional />
                  ))}
                </dd>
              </Fragment>
            ),
        )}
      </dl>
      <span className="sub">{note}</span>
    </div>
  );
}

/** A track type's name in a sentence, e.g. "music track without lyrics". */
const typeName = (qid: string) => TRACK_TYPES.find(([q]) => q === qid)?.[1] ?? qid;
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A track's P31, which it takes from the album unless it has its own, or MusicBrainz says
 * the recording is instrumental. An existing track keeps the one it has.
 */
function TrackType({
  n,
  track,
  settings,
  linkedTrack,
  onChange,
}: {
  n: number;
  track: Track;
  settings: Settings;
  linkedTrack: boolean;
  onChange: (type: string) => void;
}) {
  const id = useId();
  const fallback = trackTypeOf(settings, { mb: track.mb });
  // A track's own type that's the one it would get anyway reads as that one, not twice.
  const value = track.type && track.type !== fallback.qid ? track.type : "";
  const note = linkedTrack
    ? "Not used, as the track is an existing one."
    : !value && fallback.fromMb
      ? track.mb?.attributes?.includes("instrumental")
        ? "MusicBrainz says the recording is instrumental."
        : "MusicBrainz says the work has no linguistic content."
      : "";
  return (
    <div className="f">
      <label htmlFor={id}>Track type</label>
      <select
        id={id}
        data-col="type"
        aria-label={`Track ${n} type`}
        disabled={linkedTrack}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {`${capitalized(typeName(fallback.qid))} (${fallback.fromMb ? "from MusicBrainz" : "default for album"})`}
        </option>
        {TRACK_TYPES.filter(([q]) => q !== fallback.qid).map(([q, l]) => (
          <option key={q} value={q}>
            {capitalized(l)}
          </option>
        ))}
      </select>
      {note && (
        <span className="sub with-badge">
          {!linkedTrack && <span className="mb-badge">MB</span>}
          {note}
        </span>
      )}
    </div>
  );
}

/** A language's name, e.g. "English" or "no linguistic content", or its QID. */
const langName = (qid: string) =>
  qid === NO_LINGUISTIC_CONTENT
    ? "no linguistic content"
    : (LANGS.find(([q]) => q === qid)?.[1] ?? qid);
const langNames = (qids: string[]) =>
  qids.length ? capitalized(qids.map(langName).join(" and ")) : "None";

const LANG_SOURCES = {
  album: "default for album",
  mb: "from MusicBrainz",
  type: "as it's without lyrics",
  vocals: "as it has vocals",
} as const;

/**
 * The language of a track's composition, which it takes from the work on MusicBrainz or
 * the album unless it has its own. An existing composition keeps the one it has.
 */
function TrackLang({
  n,
  track,
  settings,
  linkedComp,
  error,
  onChange,
}: {
  n: number;
  track: Track;
  settings: Settings;
  linkedComp: boolean;
  error: string | undefined;
  onChange: (lang: string | undefined, custom: boolean) => void;
}) {
  const id = useId();
  const fallback = trackLangOf(settings, { ...track, p407: undefined });
  // As with the type, a track's own language that's the one it would get anyway isn't listed
  // again, and reads as that one.
  const same = fallback.qids.length === 1 ? fallback.qids[0] : fallback.qids.length ? null : "";
  const own =
    track.p407 === undefined ? undefined : isCustomTrackLang(track) ? "other" : track.p407.trim();
  const value = own === undefined || own === same ? "" : own || "none";
  const note = linkedComp
    ? "Not used, as the composition is an existing one."
    : value === "" && fallback.from === "mb"
      ? "From the work's language on MusicBrainz"
      : value === "" && fallback.from === "type"
        ? "A track without lyrics gets no linguistic content."
        : "";
  return (
    <div className="f">
      <label htmlFor={id}>Language</label>
      <select
        id={id}
        data-col="lang"
        aria-label={`Track ${n} language`}
        disabled={linkedComp}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange(undefined, false);
          else if (v === "other") onChange("", true);
          else onChange(v === "none" ? "" : v, false);
        }}
      >
        <option value="">{`${langNames(fallback.qids)} (${LANG_SOURCES[fallback.from ?? "album"]})`}</option>
        {same !== "" && <option value="none">None</option>}
        {same !== NO_LINGUISTIC_CONTENT && (
          <optgroup label="Instrumental">
            <option value={NO_LINGUISTIC_CONTENT}>No linguistic content</option>
          </optgroup>
        )}
        <optgroup label="Languages">
          {LANGS.filter(([q]) => q !== same).map(([q, l]) => (
            <option key={q} value={q}>
              {l}
            </option>
          ))}
        </optgroup>
        <option value="other">Other QID…</option>
      </select>
      {value === "other" && (
        <QidInput
          className="mono"
          placeholder="Q…"
          aria-label={`Track ${n} language QID`}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-err`}
          value={track.p407 ?? ""}
          onChange={(v) => onChange(v, true)}
        />
      )}
      {note && (
        <span className="sub with-badge">
          {fallback.from === "mb" && !linkedComp && <span className="mb-badge">MB</span>}
          {note}
        </span>
      )}
      <FieldErr id={id} msg={error} />
    </div>
  );
}

/**
 * A closed card's tag for a track whose language isn't the album's, or null. One that's
 * only because it's without lyrics has its type's tag already.
 */
function langTag(track: Track, settings: Settings) {
  const { qids, from } = trackLangOf(settings, track);
  const album = trackLangOf(settings, { mb: null }).qids;
  // A language typed in that isn't a QID yet has an error to show instead.
  if (from === "type" || from === "vocals" || qids.join() === album.join()) return null;
  if (isCustomTrackLang(track) && !qids.length) return null;
  return (
    <span key="lang" className="fact-tag with-badge">
      {langNames(qids)}
      {from === "mb" && <span className="mb-badge">MB</span>}
    </span>
  );
}

/**
 * When a track was recorded, which it takes from MusicBrainz or the album unless it has its
 * own. An existing track only gets it if it has none.
 */
function Recorded({
  n,
  track,
  settings,
  linkedTrack,
  error,
  onChange,
}: {
  n: number;
  track: Track;
  settings: Settings;
  linkedTrack: boolean;
  error: string | undefined;
  onChange: (date: string) => void;
}) {
  const id = useId();
  const fallback = trackRecordedOf(settings, { mb: track.mb });
  const own = track.recorded !== undefined;
  const mb = track.mb?.recorded;
  const range =
    mb?.end && !own ? `MusicBrainz has ${mb.begin} to ${mb.end}. Using the first date.` : "";
  const note = linkedTrack
    ? `Added to the existing track only if it has none.${range && ` ${range}`}`
    : range
      ? range
      : mb && !own
        ? "From the recording on MusicBrainz"
        : mb
          ? `MusicBrainz has ${mb.begin}${mb.end ? ` to ${mb.end}` : ""}`
          : fallback.date && !own
            ? "Default from Item settings"
            : "";
  return (
    <div className="f">
      <label htmlFor={id}>Recording date</label>
      <input
        id={id}
        type="text"
        className="mono"
        data-col="recorded"
        spellCheck={false}
        aria-label={`Track ${n} recording date`}
        placeholder={fallback.date || "YYYY, YYYY-MM or YYYY-MM-DD"}
        value={track.recorded ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-err`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normalizeDate(e.target.value))}
      />
      {note && (
        <span className="sub with-badge">
          {mb && !linkedTrack && <span className="mb-badge">MB</span>}
          {note}
        </span>
      )}
      <FieldErr id={id} msg={error} />
    </div>
  );
}

/**
 * What kind of recording a track is, which it takes from the album and MusicBrainz unless
 * it has its own. Changing one makes them all its own, until they're the same again.
 */
function RecTypes({
  n,
  track,
  settings,
  linkedTrack,
  onChange,
}: {
  n: number;
  track: Track;
  settings: Settings;
  linkedTrack: boolean;
  onChange: (qids: string[] | null) => void;
}) {
  const { qids, fromMb } = trackRecTypesOf(settings, track);
  const fallback = trackRecTypesOf(settings, { mb: track.mb }).qids;
  const toggle = (q: string) => {
    const next = qids.includes(q) ? qids.filter((x) => x !== q) : [...qids, q];
    const same = next.length === fallback.length && next.every((x) => fallback.includes(x));
    onChange(same ? null : next);
  };
  const note = linkedTrack
    ? "Added to the existing track only if it has none."
    : track.recTypes
      ? "Overriding the album default."
      : null;
  return (
    <div className="f wide" role="group" aria-label={`Track ${n} recording type`}>
      <span>Recording type</span>
      <div className="rt-chips">
        {REC_TYPES.map(([q, l]) => (
          <button
            key={q}
            type="button"
            className="rt-chip"
            data-col={q === REC_TYPES[0][0] ? "rectype" : undefined}
            aria-pressed={qids.includes(q)}
            onClick={() => toggle(q)}
          >
            {fromMb.includes(q) && <span className="mb-badge">MB</span>}
            {capitalized(l)}
          </button>
        ))}
      </div>
      {note && (
        <span className="sub">
          {note}
          {track.recTypes && (
            <>
              {" "}
              <button type="button" className="link" onClick={() => onChange(null)}>
                Use the album's
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** A closed card's "Studio recording", or null for a track with no recording type. */
function recTypesFact(track: Track, settings: Settings) {
  const { qids } = trackRecTypesOf(settings, track);
  if (!qids.length) return null;
  return <span key="rectypes">{capitalized(qids.map(recTypeName).join(", "))}</span>;
}

/** A closed card's "Recorded Nov 2025", or null for a track with no recording date. */
function recordedFact(track: Track, settings: Settings) {
  const { date, from } = trackRecordedOf(settings, track);
  const parsed = parseDate(date);
  if (from === "album" || !parsed.ok || !parsed.val) return null;
  return (
    <span key="recorded" className="with-badge">
      {`Recorded ${formatTime(parsed.val.time, parsed.val.precision)}`}
      {from === "mb" && <span className="mb-badge">MB</span>}
    </span>
  );
}

/** A closed card's tag for a track whose type isn't the album's, or null. */
function typeTag(track: Track, settings: Settings) {
  const { qid, fromMb } = trackTypeOf(settings, track);
  if (qid === settings.trackType) return null;
  return (
    <span key="type" className="fact-tag with-badge">
      {qid === WITHOUT_LYRICS ? "Instrumental" : capitalized(typeName(qid))}
      {fromMb && <span className="mb-badge">MB</span>}
    </span>
  );
}

/**
 * The existing composition and track a row reuses, by QID, under a heading of their
 * own, each with its matches to review.
 */
function LinkFields({
  di,
  n,
  errs,
  disc,
  review,
  setDisc,
}: {
  di: number;
  n: number;
  errs: RowErrs;
  disc: Disc;
  review: TrackReview | undefined;
  setDisc: (fn: (disc: Disc) => void) => void;
}) {
  const ids = useId();
  const kinds = [
    { k: "comp", name: "Composition", lower: "composition" },
    { k: "track", name: "Track", lower: "track" },
  ] as const;
  const set = (k: "comp" | "track", q: string) =>
    setDisc((d) => {
      if (q.trim()) d[k][n] = q.trim();
      else delete d[k][n];
    });
  return (
    <>
      <div className="wide link-head">
        <span className="kicker">Links to existing</span>
        <span className="muted">Reuse items already on Wikidata instead of creating new.</span>
      </div>
      {kinds.map(({ k, name, lower }) => {
        const found = review?.candidates.filter((c) => c.slot === k && !c.used).length ?? 0;
        return (
          <div key={k} className="f">
            <label htmlFor={`${ids}-${k}`}>{name}</label>
            <QidInput
              id={`${ids}-${k}`}
              className="mono"
              placeholder="Q…"
              aria-label={`Track ${n} existing ${lower}`}
              aria-invalid={!!errs[k]}
              aria-describedby={errs[k] ? `${ids}-${k}-err` : undefined}
              value={disc[k][n] ?? ""}
              onChange={(q) => set(k, q)}
            />
            {found > 0 ? (
              <span className="sub match-hint">
                <i className="match-dot" aria-hidden="true" />
                {plural(found, "possible match", "possible matches")}
                <a href={`#${groupId(di, n)}`}>Review ↓</a>
              </span>
            ) : (
              !disc[k][n]?.trim() && (
                <span className="sub">{`Leave empty to create a new ${lower}.`}</span>
              )
            )}
            {errs[k] && <CellErr id={`${ids}-${k}-err`}>{errs[k]}</CellErr>}
          </div>
        );
      })}
    </>
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
 * Scroll to a performer's row in Performers and focus its QID, or its Change button once it's
 * linked. False if it isn't there.
 */
function goToPerformer(name: string): boolean {
  const row = [...document.querySelectorAll<HTMLElement>("#performers [data-performer]")].find(
    (el) => el.dataset.performer === name,
  );
  const input = row?.querySelector<HTMLElement>("input, .perf-change");
  if (!row || !input) return false;
  row.scrollIntoView({ block: "center" });
  input.focus({ preventScroll: true });
  return true;
}

/**
 * An artist, with a green dot once it's linked to a QID. It goes to the artist in People.
 * An `optional` one, a writer, is left off rather than needed when it isn't linked.
 */
function PerformerChip({
  name,
  linked,
  optional = false,
}: {
  name: string;
  linked: boolean;
  optional?: boolean;
}) {
  return (
    <a
      className={cls("who-chip", !linked && (optional ? "unlinked" : "todo"))}
      href="#performers"
      onClick={(e) => {
        if (goToPerformer(name)) e.preventDefault();
      }}
    >
      <i aria-hidden="true" />
      {name}
      {linked ? (
        <span className="visually-hidden">, linked</span>
      ) : optional ? (
        " · not linked"
      ) : (
        " · needs QID"
      )}
    </a>
  );
}

const hasPerformers = (p: ReturnType<typeof rowPerformers>) =>
  p.only.length + p.with.length + p.feat.length > 0;

/** Who a row credits beyond the artists above the cards, as chips. */
function RowArtists({
  performers: p,
  prefixed,
  linked,
}: {
  performers: ReturnType<typeof rowPerformers>;
  /** Whether there are artists above the cards that the chips differ from. */
  prefixed: boolean;
  linked: (name: string) => boolean;
}) {
  const chips = (names: string[]) =>
    names.map((a) => <PerformerChip key={a} name={a} linked={linked(a)} />);
  const groups = [
    p.only.length > 0 && (["Only", p.only] as const),
    p.with.length > 0 && ([prefixed ? "With" : "", p.with] as const),
    p.feat.length > 0 && (["feat.", p.feat] as const),
  ].filter((g) => g !== false);
  return (
    groups.length > 0 && (
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

/** The facts shown as text rather than as identifiers. */
const PLAIN_FACTS = new Set(["Duration", "Composer", "Lyricist"]);

/** What a row's MB badge lists: its imported values, for the track and for the composition. */
interface MbFacts {
  track: [string, string][];
  comp: [string, string][];
  /** Why a section adds less: the row links an existing item. */
  linked: { track: boolean; comp: boolean };
  /** What a linked item still gets: its MusicBrainz ID and writers. */
  extend: { track: [string, string][]; comp: [string, string][] };
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
  linkedComp: boolean,
  linkedTrack: boolean,
  /** The Composers and lyricists setting. */
  withWriters: boolean,
): MbFacts | null {
  const ids = raw.mb;
  if (!ids) return null;
  const many = (label: string, vs: string[]) => vs.map((v): [string, string] => [label, v]);
  const recording = many("Recording ID", ids.recording ? [ids.recording] : []);
  const work = many("Work ID", ids.work ? [ids.work] : []);
  const track: [string, string][] = [
    ...recording,
    ...many("ISRC", ids.isrcs),
    ...(raw.seconds !== null ? [["Duration", durationNote(raw)] as [string, string]] : []),
    ...many("Spotify", ids.spotify),
    ...many("Apple Music", ids.appleMusic),
    ...many("Deezer", ids.deezer),
    ...many("Tidal", ids.tidal),
  ];
  const writers: [string, string][] = withWriters
    ? [
        ...many(
          "Composer",
          ids.composers.map((w) => w.name),
        ),
        ...many(
          "Lyricist",
          ids.lyricists.map((w) => w.name),
        ),
      ]
    : [];
  const comp: [string, string][] = [...work, ...many("ISWC", ids.iswcs), ...writers];
  if (!track.length && !comp.length) return null;
  return {
    track,
    comp,
    linked: { track: linkedTrack, comp: linkedComp },
    extend: { track: recording, comp: [...work, ...writers] },
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
 * items. Escape, a click outside or moving focus out closes it. Escape closes only
 * it, not the open card it's in.
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
  const escape = (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Escape") return;
    e.preventDefault();
    close(true);
  };
  const section = (
    kind: "track" | "comp",
    name: string,
    rows: [string, string][],
    linkedNote: string,
    extendNote: string,
  ) => {
    if (!rows.length) return false;
    const linked = facts.linked[kind];
    const shown = linked ? facts.extend[kind] : rows;
    return (
      <div className="mb-pop-section">
        <h4>
          <span className={`sw ${kind}`} aria-hidden="true" />
          {name}
        </h4>
        {linked && <p className="muted">{shown.length ? extendNote : linkedNote}</p>}
        {shown.length > 0 && (
          <dl className="kv">
            {shown.map(([k, v], i) => (
              <Fragment key={i}>
                <dt>{k}</dt>
                <dd className={PLAIN_FACTS.has(k) ? undefined : "mono"}>{v}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  };
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
        onKeyDown={escape}
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
          onKeyDown={escape}
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
              <span className="muted">Added in full only if this row creates the item</span>
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
            "This row links an existing track. It only gets the recording ID, unless it already has one.",
          )}
          {section(
            "comp",
            "Composition",
            facts.comp,
            "This row links an existing composition, so these aren't added.",
            facts.extend.comp.some(([k]) => k !== "Work ID")
              ? "This row links an existing composition. It only gets the work ID, unless it already has one, and the composers and lyricists it doesn't have yet."
              : "This row links an existing composition. It only gets the work ID, unless it already has one.",
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
