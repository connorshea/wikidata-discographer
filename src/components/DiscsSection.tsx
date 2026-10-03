import { Fragment, useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import { emptyDisc } from "../lib/state.ts";
import {
  type Answered,
  fillUnambiguous,
  openMatches,
  pickSingle,
  pickTrack,
  stillValid,
} from "../lib/matches.ts";
import {
  isCustomPart,
  normalizeQid,
  PARTS,
  QID,
  type Plan,
  type Row,
  splitArtists,
  type State,
} from "../lib/plan.ts";
import type { Match, MatchesRequest, MatchesResponse, RowMatches } from "../lib/api-types.ts";
import { Pids, QidInput, WikiLink } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import type { SectionProps } from "./types.ts";

const cls = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ") || undefined;

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

type Matches = MatchesResponse["rows"];

/** Where the lookup for existing items stands, for the line above each table. */
type MatchStatus = "off" | "pending" | "done" | "failed";

/**
 * Existing compositions, tracks and singles in the mirror for the parsed
 * rows: same title and a shared performer, or on the existing album.
 */
function useMatches(state: State, plan: Plan): { matches: Matches; status: MatchStatus } {
  const albumQid = state.album.qid.trim();
  const request: MatchesRequest = {
    albumQid: state.album.mode === "existing" && QID.test(albumQid) ? albumQid : "",
    rows: plan.parsed.flatMap((rows, di) =>
      rows.flatMap((r) =>
        r.error !== undefined
          ? []
          : [
              {
                key: `${di}:${r.n}`,
                title: r.title,
                performers: r.artists
                  .map((a) => (state.artists[a] ?? "").trim())
                  .filter((q) => QID.test(q)),
              },
            ],
      ),
    ),
  };
  // Debounce the serialized request: a fresh object every render would never settle.
  const current = JSON.stringify(request);
  const key = useDebounced(current, 600);
  const [answered, setAnswered] = useState<Answered | null>(null);
  // The request last answered (or failed), to tell when one is in flight.
  const [settled, setSettled] = useState<{ key: string; failed: boolean } | null>(null);
  useEffect(() => {
    const body = JSON.parse(key) as MatchesRequest;
    // The server only matches by a performer or the album; without either, don't ask.
    if (!body.albumQid && !body.rows.some((r) => r.performers.length)) return;
    const abort = new AbortController();
    api<MatchesResponse>("/api/items/matches", { method: "POST", body, signal: abort.signal })
      .then((r) => {
        setAnswered({ request: body, rows: r.rows });
        setSettled({ key, failed: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setSettled({ key, failed: true });
      });
    return () => abort.abort();
  }, [key]);
  // Rows edited since the last answer drop their matches at once; the rest
  // keep them while the next request is in flight.
  const canAsk = !!request.albumQid || request.rows.some((r) => r.performers.length);
  const status: MatchStatus = !canAsk
    ? "off"
    : key !== current || settled?.key !== key
      ? "pending"
      : settled.failed
        ? "failed"
        : "done";
  return { matches: stillValid(answered, request), status };
}

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

export default function DiscsSection({ state, update, plan }: SectionProps) {
  const { matches, status } = useMatches(state, plan);
  const mainArtists = albumArtists(state, plan);
  return (
    <section className="block">
      <h2>Discs</h2>
      <p className="hint">
        One tracklist per disc or side, a line per track: <code>1. Title - Artist (3:45)</code>.
        Fill in a composition or track QID to reuse an existing item instead of creating one. Items
        already on Wikidata with a track's title and performer are suggested under it.
      </p>
      {state.discs.map((_, di) => (
        <DiscBlock
          key={di}
          di={di}
          rows={plan.parsed[di] ?? []}
          matches={matches}
          status={status}
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
  matches,
  status,
  mainArtists,
  state,
  update,
  plan,
}: SectionProps & {
  di: number;
  rows: Row[];
  matches: Matches;
  status: MatchStatus;
  mainArtists: Set<string>;
}) {
  const d = state.discs[di];
  const fillable = fillUnambiguous(structuredClone(d), di, matches);
  const suggested = rows.filter(
    (r) => r.error === undefined && openMatches(d, r.n, matches[`${di}:${r.n}`]),
  ).length;
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
      {rows.length > 0 && suggested === 0 && (
        <p className="msg muted match-summary">
          {status === "off"
            ? "Give the performers QIDs to see items already on Wikidata, suggested under each track."
            : status === "pending"
              ? "Looking for items already on Wikidata…"
              : status === "failed"
                ? "Couldn't look for items already on Wikidata."
                : "No items already on Wikidata match these tracks."}
        </p>
      )}
      {suggested > 0 && (
        <div className="row match-summary">
          <p className="msg warn">
            {suggested === 1 ? "1 track" : `${suggested} tracks`} may already be on Wikidata. Check
            the suggestions under {suggested === 1 ? "it" : "them"}, so you reuse those items
            instead of creating duplicates.
          </p>
          {fillable > 0 && (
            <button
              type="button"
              className="ghost small"
              onClick={() => update((s) => void fillUnambiguous(s.discs[di], di, matches))}
            >
              Fill in {fillable} unambiguous match{fillable === 1 ? "" : "es"}
            </button>
          )}
        </div>
      )}
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
                <th>Single</th>
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
                    <tr
                      className={cls(
                        (d.single[r.n] || openMatches(d, r.n, matches[`${di}:${r.n}`])) &&
                          "has-sub",
                        d.single[r.n] && "is-single",
                      )}
                    >
                      <td className="num">{r.n}</td>
                      <td>{r.title}</td>
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
                    {openMatches(d, r.n, matches[`${di}:${r.n}`]) && (
                      <tr
                        className={cls(
                          "sub-row",
                          d.single[r.n] && "has-sub",
                          d.single[r.n] && "is-single",
                        )}
                      >
                        <td />
                        <td colSpan={6}>
                          <RowMatchList
                            n={r.n}
                            m={openMatches(d, r.n, matches[`${di}:${r.n}`])!}
                            hasSingle={!!d.single[r.n]}
                            update={(fn) => update((s) => fn(s.discs[di]))}
                          />
                        </td>
                      </tr>
                    )}
                    {d.single[r.n] && (
                      <tr className="sub-row is-single">
                        <td />
                        <td colSpan={6}>
                          <SingleFields di={di} n={r.n} {...{ state, update, plan }} />
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

/** The single's fields, on their own row under the track. */
function SingleFields({ di, n, state, update, plan }: SectionProps & { di: number; n: number }) {
  const sg = state.discs[di].single[n];
  const err = plan.singleErrs[`${di}:${n}`];
  return (
    <div className="single">
      <span className="single-label">Single</span>
      <input
        type="text"
        spellCheck={false}
        placeholder="Release date"
        aria-label={`Track ${n} single release date`}
        value={sg.date}
        onChange={(e) => update((s) => void (s.discs[di].single[n].date = e.target.value))}
      />
      <QidInput
        placeholder="or existing Q…"
        aria-label={`Track ${n} existing single`}
        value={sg.qid}
        onChange={(q) => update((s) => void (s.discs[di].single[n].qid = q.trim()))}
      />
      <button
        type="button"
        className="danger small"
        aria-label={`Remove single for track ${n}`}
        onClick={() => update((s) => void delete s.discs[di].single[n])}
      >
        ×
      </button>
      {err && <p className="field-err">{err}</p>}
    </div>
  );
}

/** A track's suggested existing items, each with a button to use it. */
function RowMatchList({
  n,
  m,
  hasSingle,
  update,
}: {
  n: number;
  m: RowMatches;
  hasSingle: boolean;
  update: (fn: (disc: State["discs"][number]) => void) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const item = (what: string, x: Match, button: string, onUse: () => void) => (
    <li key={`${what}:${x.qid}`}>
      <span className="match-kind">{what}</span>
      <WikiLink base={wikiBaseUrl} qid={x.qid} />
      <span>{x.label ?? "(no label)"}</span>
      {x.description && <span className="muted">{x.description}</span>}
      <span className="muted">({x.reasons.join(", ")})</span>
      <button type="button" className="ghost small" onClick={onUse}>
        {button}
      </button>
    </li>
  );
  return (
    <div className="row-matches">
      <span className="single-label">Already on Wikidata?</span>
      <ul className="matches">
        {m.track.map((t) =>
          item("Track", t, t.composition ? "Use (with its composition)" : "Use", () =>
            update((disc) => pickTrack(disc, n, t)),
          ),
        )}
        {m.comp.map((c) =>
          item("Composition", c, "Use", () => update((disc) => void (disc.comp[n] = c.qid))),
        )}
        {m.single.map((sg) =>
          item("Single", sg, hasSingle ? "Use" : "Add as this track's single", () =>
            update((disc) => pickSingle(disc, n, sg.qid)),
          ),
        )}
      </ul>
    </div>
  );
}
