import { Fragment, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { emptyDisc } from "../lib/state.ts";
import { groupId, type TrackReview } from "../lib/matches.ts";
import {
  isCustomPart,
  normalizeQid,
  PARTS,
  parseDate,
  QID,
  type Plan,
  type Row,
  splitArtists,
  type State,
} from "../lib/plan.ts";
import { InfoTip, Pids, QidInput, WikiLink } from "./common.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import type { SectionProps } from "./types.ts";

const cls = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * The album's artists, to dim on each row so features stand out: as entered
 * for a new album, or else those on every track.
 */
function albumArtists(state: State, plan: Plan): Set<string> {
  if (state.album.mode === "create")
    return new Set(splitArtists(state.album.artists, state.settings.splitArtists).filter(Boolean));
  const rows = plan.parsed.flat().filter((r) => r.error === undefined);
  if (rows.length < 2) return new Set();
  return new Set(rows[0].artists.filter((a) => rows.every((r) => r.artists.includes(a))));
}

export default function DiscsSection({
  state,
  update,
  plan,
  reviews,
}: SectionProps & { reviews: TrackReview[] }) {
  const mainArtists = albumArtists(state, plan);
  return (
    <section className="block">
      <h2>Discs</h2>
      <p className="hint">
        One tracklist per disc or side, a line per track: <code>1. Title - Artist (3:45)</code>.
        Fill in a composition or track QID to reuse an existing item instead of creating one. Items
        already on Wikidata with a track's title are listed under Possible matches.
      </p>
      {state.discs.map((_, di) => (
        <DiscBlock
          key={di}
          di={di}
          rows={plan.parsed[di] ?? []}
          reviews={reviews.filter((r) => r.di === di)}
          mainArtists={mainArtists}
          {...{ state, update, plan }}
        />
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() => update((s) => void s.discs.push(emptyDisc()))}
      >
        Add disc
      </button>
    </section>
  );
}

function DiscBlock({
  di,
  rows,
  reviews,
  mainArtists,
  state,
  update,
  plan,
}: SectionProps & {
  di: number;
  rows: Row[];
  reviews: TrackReview[];
  mainArtists: Set<string>;
}) {
  const d = state.discs[di];
  const open = new Map(reviews.filter((r) => !r.reviewed).map((r) => [r.n, r]));
  const custom = isCustomPart(d);
  const setDisc = (fn: (disc: (typeof state.discs)[number]) => void) =>
    update((s) => fn(s.discs[di]));
  return (
    <div className="disc">
      <div className="head">
        <h3>Disc {di + 1}</h3>
        {state.discs.length > 1 && (
          <button
            type="button"
            className="danger small"
            onClick={() => update((s) => void s.discs.splice(di, 1))}
          >
            Remove disc
          </button>
        )}
      </div>
      <div className="grid">
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
          <span className="sub">Blank for a single-disc album</span>
        </label>
      </div>
      <label className="f" style={{ marginTop: 12 }}>
        Tracklist
        <textarea
          rows={14}
          spellCheck={false}
          value={d.text}
          onChange={(e) => setDisc((disc) => void (disc.text = e.target.value))}
        />
      </label>
      {open.size > 0 && <UnreviewedNotice count={open.size} />}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Artists</th>
                <th>Length</th>
                <th>Existing composition</th>
                <th>Existing track</th>
                <th>
                  Single
                  <InfoTip id={`disc${di}-single`} label="About singles" end>
                    Tick a track that was also released as a single. The single becomes its own
                    item, an instance of single (Q134556) with the track’s title and artists, that
                    lists the track and is taken from the album. Its Edit button sets a release date
                    (the album’s if blank), or an existing single’s QID to link that one instead of
                    creating a new one. Untick it to remove the single.
                  </InfoTip>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                r.error !== undefined ? (
                  <tr key={i}>
                    <td className="err" colSpan={7}>
                      {r.error}: <code>{r.raw}</code>
                    </td>
                  </tr>
                ) : (
                  <Fragment key={i}>
                    <tr className={cls(d.single[r.n] && "has-sub", d.single[r.n] && "is-single")}>
                      <td className="num">{r.n}</td>
                      <td>
                        <span className="title-cell">
                          {r.title}
                          {open.has(r.n) && <MatchFlag review={open.get(r.n)!} />}
                        </span>
                      </td>
                      <td>
                        {r.artists.map((a, j) => (
                          <Fragment key={j}>
                            {j > 0 && ", "}
                            <span className={mainArtists.has(a) ? "muted" : undefined}>{a}</span>
                          </Fragment>
                        ))}
                      </td>
                      <td className="num">{fmt(r.seconds)}</td>
                      {(["comp", "track"] as const).map((k) => {
                        const v = (d[k][r.n] ?? "").trim();
                        return (
                          <td key={k}>
                            <QidInput
                              className="quiet"
                              placeholder="Q…"
                              aria-label={`Track ${r.n} existing ${k === "comp" ? "composition" : "track"}`}
                              aria-invalid={v !== "" && !QID.test(v)}
                              value={d[k][r.n] ?? ""}
                              onChange={(q) =>
                                setDisc((disc) => {
                                  if (q.trim()) disc[k][r.n] = q.trim();
                                  else delete disc[k][r.n];
                                })
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="single-toggle">
                        <input
                          type="checkbox"
                          aria-label={`Track ${r.n} is a single`}
                          checked={!!d.single[r.n]}
                          onChange={(e) =>
                            update((s) => {
                              const disc = s.discs[di];
                              if (e.target.checked) disc.single[r.n] = { date: "", qid: "" };
                              else delete disc.single[r.n];
                            })
                          }
                        />
                      </td>
                    </tr>
                    {d.single[r.n] && (
                      <tr className="sub-row is-single">
                        <td />
                        <td colSpan={6}>
                          <SingleRow di={di} n={r.n} {...{ state, update, plan }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * A track's single, on its own row under the track: a one-line summary, or
 * its fields once Edit is clicked. The fields stay open while something is
 * wrong with them, and Done only closes them once nothing is.
 */
function SingleRow({ di, n, state, update, plan }: SectionProps & { di: number; n: number }) {
  const { wikiBaseUrl } = useAuth();
  const sg = state.discs[di].single[n];
  const qid = sg.qid.trim();
  const date = sg.date.trim();
  const problem = plan.singleErrs[`${di}:${n}`];
  const [editing, setEditing] = useState(false);
  if (problem && !editing) setEditing(true);
  const open = editing || !!problem;

  const editRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    // Focus follows Edit and Done, not a problem opening the fields.
    if (open && editing) dateRef.current?.focus();
    if (!open) editRef.current?.focus();
  }, [open, editing]);

  if (!open)
    return (
      <div className="single-summary">
        <span className="single-label">Single</span>
        {QID.test(qid) ? (
          <span>
            Reusing <WikiLink base={wikiBaseUrl} qid={qid} />
          </span>
        ) : (
          <span>
            New single{" "}
            <span className="muted">· {date ? `released ${date}` : "released with the album"}</span>
          </span>
        )}
        <button
          ref={editRef}
          type="button"
          className="ghost quiet small"
          aria-label={`Edit single for track ${n}`}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>
    );
  return (
    <div className="single-panel">
      <label className="f">
        <Pids>Release date (P577)</Pids>
        <input
          ref={dateRef}
          type="text"
          className="date"
          spellCheck={false}
          placeholder="YYYY-MM-DD, blank = album"
          aria-invalid={date !== "" && !parseDate(date).ok}
          value={sg.date}
          onChange={(e) => update((s) => void (s.discs[di].single[n].date = e.target.value))}
        />
      </label>
      <label className="f">
        Existing single
        <QidInput
          placeholder="Q… to reuse, blank to create"
          aria-invalid={qid !== "" && !QID.test(qid)}
          value={sg.qid}
          onChange={(q) => update((s) => void (s.discs[di].single[n].qid = q.trim()))}
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
      {problem && (
        <p className="field-err" aria-live="polite">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A warning icon on a track with possible matches to review, linked to them. */
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
