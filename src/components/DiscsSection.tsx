import { Fragment, useEffect, useRef, useState } from "react";
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
  type Plan,
  type Settings,
  type State,
  type Track,
} from "../lib/plan.ts";
import { InfoTip, Pids, QidInput, WikiLink } from "./common.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import { type ItemLookup, useItemSummaries } from "./use-item-summaries.ts";
import type { SectionProps } from "./types.ts";

const cls = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

const fmt = (sec: number | null) =>
  sec === null ? "–" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * The album's artists, to dim on each row so features stand out: as entered
 * for a new album, or else those on every track.
 */
function mainArtistsOf(state: State, plan: Plan): Set<string> {
  if (state.album.mode === "create") return new Set(albumArtists(state));
  const rows = plan.tracks.flat();
  if (rows.length < 2) return new Set();
  return new Set(rows[0].artists.filter((a) => rows.every((r) => r.artists.includes(a))));
}

export default function DiscsSection({
  state,
  update,
  plan,
  reviews,
}: SectionProps & { reviews: TrackReview[] }) {
  const mainArtists = mainArtistsOf(state, plan);
  const lookup = useItemSummaries(
    state.discs.flatMap((d) => Object.values(d.single).map((sg) => sg.qid.trim())),
    state.settings.lang,
  );
  return (
    <section className="block">
      <h2>Discs</h2>
      <p className="hint">
        One tracklist per disc or side, filled in by a MusicBrainz import. Fill in a composition or
        track QID to reuse an existing item instead of creating one. Items already on Wikidata with
        a track's title are listed under "Possible matches". A row marked "MB" has identifiers from
        a MusicBrainz import.
      </p>
      {state.discs.map((_, di) => (
        <DiscBlock
          key={di}
          di={di}
          rows={plan.tracks[di] ?? []}
          reviews={reviews.filter((r) => r.di === di)}
          mainArtists={mainArtists}
          lookup={lookup}
          {...{ state, update, plan }}
        />
      ))}
    </section>
  );
}

function DiscBlock({
  di,
  rows,
  reviews,
  mainArtists,
  lookup,
  state,
  update,
  plan,
}: SectionProps & {
  di: number;
  rows: Track[];
  reviews: TrackReview[];
  mainArtists: Set<string>;
  lookup: Lookup;
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
                    lists the track and is taken from the album. Its Edit button sets the new
                    single’s release date, or an existing single’s QID to link that one instead, and
                    its Discogs master ID. Currently, you can only create singles with one track.
                  </InfoTip>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={i}>
                  <tr className={cls(d.single[r.n] && "has-sub", d.single[r.n] && "is-single")}>
                    <td className="num">{r.n}</td>
                    <td>
                      <span className="title-cell">
                        {r.title}
                        {open.has(r.n) && <MatchFlag review={open.get(r.n)!} />}
                        <MbChip track={r} settings={state.settings} />
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
                            if (e.target.checked)
                              disc.single[r.n] = { date: "", qid: "", discogs: "" };
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
                        <SingleRow di={di} n={r.n} {...{ lookup, state, update, plan }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
