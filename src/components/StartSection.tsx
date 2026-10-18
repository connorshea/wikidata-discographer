// The form's first step: a picker of where to start from, which collapses into
// a summary bar once one is applied.
import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { QID, type StartingPoint, type State } from "../lib/plan.ts";
import { startSummary } from "../lib/progress.ts";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import type { AddItemResponse, SearchItem, SearchResponse } from "../lib/api-types.ts";
import { FieldErr, QidInput } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import { AlbumTypeSelect, ArtistChips } from "./AlbumSection.tsx";
import { type MbReport, reportCounts } from "../lib/musicbrainz.ts";
import MusicBrainzImport, {
  ImportReport,
  type MusicBrainzImportHandle,
} from "./MusicBrainzImport.tsx";
import type { SectionProps } from "./types.ts";

/** What the rest of the form can ask of the start step. */
export interface StartHandle {
  /** Back to the picker, with `card` picked, keeping the rest of the form. */
  change: (card?: StartingPoint) => void;
  /** Back to the picker to load a release group onto an existing album (see MusicBrainzImport). */
  loadReleaseGroup: (mbid: string, album: string) => void;
}

const OPTIONS: { id: StartingPoint; title: string; desc: string; icon: string }[] = [
  {
    id: "mb",
    title: "MusicBrainz release",
    desc: "Paste a MusicBrainz link and most info will auto-fill for you",
    icon: "M10 3v9M6.5 8.5L10 12l3.5-3.5M4 13.5V16h12v-2.5",
  },
  {
    id: "existing",
    title: "Existing album QID",
    desc: "An album on Wikidata with no tracklist yet",
    icon: "M4 4h12v12H4zM7 10l2 2 4-4",
  },
  {
    id: "search",
    title: "Search by name",
    desc: "Find an album or EP already on Wikidata",
    icon: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5L17 17",
  },
  {
    id: "new",
    title: "New album from scratch",
    desc: "Create the album item along with its tracks",
    icon: "M10 4v12M4 10h12",
  },
];

function StartIcon({ start, on }: { start: StartingPoint; on: boolean }) {
  return (
    <span className={`start-icon${on ? " on" : ""}`} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d={OPTIONS.find((o) => o.id === start)!.icon} />
      </svg>
    </span>
  );
}

export default function StartSection({
  state,
  update,
  plan,
  albumLabel,
  onLoad,
  ref,
}: SectionProps & {
  /** The existing album's label on Wikidata, while it's known. */
  albumLabel: string | null;
  onLoad: (next: State) => void;
  ref?: Ref<StartHandle>;
}) {
  const picking = !state.start;
  const [card, setCard] = useState<StartingPoint | null>(null);
  // The starting point Change left, and the album as it was then, to go back to them.
  // The panels change the album while picking (a new album's title, artists and type).
  const [prev, setPrev] = useState<{ start: StartingPoint; album: State["album"] } | null>(null);
  // The search, kept here so "Pick a different album" comes back to it.
  const [query, setQuery] = useState("");
  // What the last MusicBrainz load found, and whether its report is open
  // when nothing in it needs attention.
  const [report, setReport] = useState<MbReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const reportId = useId();
  const mbImport = useRef<MusicBrainzImportHandle>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  // Set by Change, to move focus to the picker once it's shown.
  const focusHead = useRef(false);
  // Set by a click on a card, so its panel's first field takes focus. Arrow
  // keys also pick a card, and moving focus then would stop them stepping
  // through the cards.
  const clicked = useRef(false);
  const focusPanel = useRef(false);

  const change = (to?: StartingPoint) => {
    if (state.start) setPrev({ start: state.start, album: structuredClone(state.album) });
    setCard(to ?? state.start);
    focusHead.current = true;
    update((s) => void (s.start = null));
  };

  useImperativeHandle(ref, () => ({
    change,
    loadReleaseGroup: (mbid, album) => {
      change("mb");
      sectionRef.current?.scrollIntoView({ block: "start" });
      mbImport.current?.loadReleaseGroup(mbid, album);
    },
  }));

  useEffect(() => {
    if (!picking || !focusHead.current) return;
    focusHead.current = false;
    headRef.current?.focus({ preventScroll: true });
  }, [picking]);

  useEffect(() => {
    if (!focusPanel.current) return;
    focusPanel.current = false;
    sectionRef.current?.querySelector<HTMLElement>(".start-panel input")?.focus();
  }, [card]);

  const summary = startSummary(state, plan, albumLabel);
  const shownReport = state.start === "mb" ? report : null;
  const counts = shownReport && reportCounts(shownReport);
  const reportShown = !!counts && (counts.attention || reportOpen);
  return (
    <section className={`block start${picking ? "" : " started"}`} id="start" ref={sectionRef}>
      {picking ? (
        <>
          <div className="start-head">
            <div>
              <h2 tabIndex={-1} ref={headRef}>
                How do you want to start?
              </h2>
              <p className="hint">
                Pick a starting point. You can still change anything in the form afterwards.
              </p>
            </div>
            {/* Back to the starting point Change left, with nothing changed. */}
            {prev && (
              <button
                type="button"
                className="link start-change"
                onClick={() =>
                  update((s) => {
                    s.start = prev.start;
                    s.album = structuredClone(prev.album);
                  })
                }
              >
                Cancel
              </button>
            )}
          </div>
          <div className="start-cards" role="radiogroup" aria-label="Starting point">
            {OPTIONS.map((o) => (
              <label
                className="start-card"
                key={o.id}
                onPointerDown={() => void (clicked.current = true)}
              >
                <input
                  type="radio"
                  name="start"
                  className="visually-hidden"
                  checked={card === o.id}
                  onChange={() => {
                    focusPanel.current = clicked.current;
                    clicked.current = false;
                    setCard(o.id);
                  }}
                />
                <StartIcon start={o.id} on={card === o.id} />
                <span className="start-card-text">
                  <b>{o.title}</b>
                  <span>{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : (
        summary && (
          <div className="start-bar">
            <StartIcon start={state.start!} on />
            <div className="start-bar-text">
              <span className="kicker">{summary.from}</span>
              <span>
                <b>{summary.title}</b>
                {summary.details.length > 0 && (
                  <span className="muted"> · {summary.details.join(" · ")}</span>
                )}
                {counts && !reportShown && (
                  <span className="muted">
                    {counts.found > 0 && ` · ${counts.found} already on Wikidata`}
                    {counts.added > 0 && ` · ${counts.added} IDs added`}
                  </span>
                )}
              </span>
            </div>
            {state.start === "mb" && state.album.mb?.release && (
              <a
                className="start-link"
                href={`https://musicbrainz.org/release/${encodeURIComponent(state.album.mb.release)}`}
                target="_blank"
                rel="noreferrer"
              >
                View on MusicBrainz ↗
              </a>
            )}
            {counts && !counts.attention && (
              <button
                type="button"
                className="link start-change"
                aria-expanded={reportOpen}
                aria-controls={reportOpen ? reportId : undefined}
                onClick={() => setReportOpen(!reportOpen)}
              >
                {reportOpen ? "Hide details" : "Details"}
              </button>
            )}
            <button type="button" className="link start-change" onClick={() => change()}>
              Change
            </button>
          </div>
        )
      )}
      {!picking && shownReport && reportShown && (
        <ImportReport id={reportId} report={shownReport} />
      )}
      {picking && card === "existing" && <ExistingPanel state={state} update={update} />}
      {picking && card === "search" && (
        <SearchPanel update={update} query={query} setQuery={setQuery} onPick={setCard} />
      )}
      {picking && card === "new" && <NewPanel state={state} update={update} />}
      <MusicBrainzImport
        ref={mbImport}
        state={state}
        showForm={picking && card === "mb"}
        onLoad={(next, r) => {
          setReport(r);
          setReportOpen(false);
          onLoad(next);
        }}
      />
    </section>
  );
}

/** An existing album, by its QID or Wikidata URL. */
function ExistingPanel({ state, update }: Omit<SectionProps, "plan">) {
  const id = useId();
  const [qid, setQid] = useState(state.album.mode === "existing" ? state.album.qid : "");
  const [error, setError] = useState("");
  return (
    <form
      className="start-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const q = qid.trim();
        if (!QID.test(q)) return setError("Enter a QID such as Q42, or the album's Wikidata URL.");
        update((s) => {
          s.album.mode = "existing";
          s.album.qid = q;
          s.start = "existing";
        });
      }}
    >
      <label htmlFor={id}>Album QID or Wikidata URL</label>
      <div className="row">
        <QidInput
          id={id}
          className="mono qid-field"
          placeholder="Q…"
          value={qid}
          aria-invalid={!!error}
          aria-describedby={`${id}-sub ${id}-err`}
          onChange={(v) => {
            setQid(v);
            setError("");
          }}
        />
        <button type="submit" disabled={!qid.trim()}>
          Use this album
        </button>
      </div>
      <span className="sub" id={`${id}-sub`}>
        The album must not have a tracklist yet. If it's on MusicBrainz, you'll be offered to load
        it from there.
      </span>
      <FieldErr id={id} msg={error} />
    </form>
  );
}

/** A search's answer, tagged with the query it answers. `items` is null if it failed. */
type SearchResult = { q: string; items: SearchItem[] | null };

/** Where refreshing a search result from Wikidata stands. */
type Refresh =
  | { status: "busy" }
  | { status: "done"; item: SearchItem }
  | { status: "failed"; error: string };

/**
 * A search of the albums and EPs already on Wikidata (as of the mirror), by
 * title. Picking one does what ExistingPanel does, with `start` "search". The
 * mirror can be a week behind, so the album card checks the pick live.
 */
function SearchPanel({
  update,
  query,
  setQuery,
  onPick,
}: Pick<SectionProps, "update"> & {
  query: string;
  setQuery: (q: string) => void;
  onPick: (card: StartingPoint) => void;
}) {
  const id = useId();
  const { user, wikiBaseUrl } = useAuth();
  const q = useDebounced(query.trim(), 600);
  const [result, setResult] = useState<SearchResult | null>(null);
  // Results refreshed from Wikidata, by QID, in case the mirror is behind
  // (a tracklist removed since). Kept across searches: they're newer.
  const [refreshes, setRefreshes] = useState<ReadonlyMap<string, Refresh>>(() => new Map());
  const setRefresh = (qid: string, r: Refresh) => setRefreshes((m) => new Map(m).set(qid, r));
  const resultsRef = useRef<HTMLUListElement>(null);
  // A refreshed result whose Refresh button had focus. The button goes once
  // it's done, so focus moves to what the result offers next.
  const focusRefreshed = useRef<string | null>(null);
  const refresh = (qid: string) => {
    setRefresh(qid, { status: "busy" });
    api<AddItemResponse>(`/api/items/${encodeURIComponent(qid)}`, { method: "POST" })
      .then((r) => {
        const focused = document.activeElement?.closest<HTMLElement>("[data-qid]");
        if (focused?.dataset.qid === qid) focusRefreshed.current = qid;
        setRefresh(qid, { status: "done", item: r.item });
      })
      .catch((err: unknown) =>
        setRefresh(qid, {
          status: "failed",
          error: err instanceof FetchError ? err.message : "Couldn't refresh it. Try again.",
        }),
      );
  };
  useEffect(() => {
    const qid = focusRefreshed.current;
    if (!qid) return;
    focusRefreshed.current = null;
    // "Use this album" if it can be used now, else "View on Wikidata".
    resultsRef.current
      ?.querySelector<HTMLElement>(
        `[data-qid="${qid}"] .search-result-actions :is(button:enabled, a)`,
      )
      ?.focus();
  }, [refreshes]);
  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const params = new URLSearchParams({ q, kind: "album,ep" });
    api<SearchResponse>(`/api/items/search?${params}`)
      .then((r) => !cancelled && setResult({ q, items: r.items }))
      .catch(() => !cancelled && setResult({ q, items: null }));
    return () => {
      cancelled = true;
    };
  }, [q]);
  const typed = query.trim();
  // Still settling, or asked and not answered yet: never show a stale answer.
  const searching = !!typed && (q !== typed || result?.q !== typed);
  const items = (!searching && typed ? result?.items : undefined)?.map((i) => {
    const r = refreshes.get(i.qid);
    return r?.status === "done" ? r.item : i;
  });
  // The first one that can be used gets the primary button.
  const first = items?.find((i) => !i.album?.tracks)?.qid;
  const create = (title: string) => {
    if (title) update((s) => void (s.album.title = title));
    onPick("new");
  };
  return (
    <div className="start-panel">
      <label htmlFor={id}>Album or EP title</label>
      <div className="search-field">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5L17 17" />
        </svg>
        <input
          id={id}
          type="search"
          value={query}
          aria-describedby={`${id}-status`}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div id={`${id}-status`} role="status" className="search-status">
        {!typed ? (
          <span className="sub">Albums and EPs already on Wikidata</span>
        ) : searching ? (
          <span className="search-state">
            <span className="spinner" aria-hidden="true" />
            Searching Wikidata…
          </span>
        ) : items === null ? (
          <span className="search-state">Couldn't search Wikidata. Try again in a moment.</span>
        ) : items?.length === 0 ? (
          <span className="search-state">
            No albums or EPs match "{typed}".{" "}
            <button type="button" className="link" onClick={() => create(typed)}>
              Create it as a new album
            </button>
          </span>
        ) : (
          <span className="sub">
            {items?.length === 1 ? "1 album or EP" : `${items?.length} albums and EPs`} on Wikidata
          </span>
        )}
      </div>
      {!!items?.length && (
        <ul className="search-results" ref={resultsRef}>
          {items.map((i) => {
            const tracks = i.album?.tracks ?? 0;
            const type = i.kind === "ep" ? "EP" : "Album";
            const label = i.label ?? i.qid;
            const refreshing = refreshes.get(i.qid);
            return (
              <li key={i.qid} className={`search-result${tracks ? " taken" : ""}`} data-qid={i.qid}>
                <span className="search-result-text">
                  <span className="search-result-title">
                    <b>{label}</b>
                    <span className="mono muted">{i.qid}</span>
                  </span>
                  {i.description && <span className="muted">{i.description}</span>}
                  <ul className="pills" aria-label={`About ${label}`}>
                    <li className="pill">{type}</li>
                    {tracks ? (
                      <li className="pill bad">
                        Has a tracklist · {tracks} track{tracks === 1 ? "" : "s"}
                      </li>
                    ) : (
                      <li className="pill ok">No tracklist yet</li>
                    )}
                    {i.album?.musicBrainz && (
                      <li className="pill">
                        <span className="mb-badge" aria-hidden="true">
                          MB
                        </span>
                        On MusicBrainz
                      </li>
                    )}
                  </ul>
                  {tracks > 0 && (
                    <span className="search-result-err" id={`${id}-${i.qid}-err`}>
                      {refreshing?.status === "done"
                        ? "It still has a tracklist on Wikidata, so Discographer can't modify it, sorry!"
                        : "Discographer can't modify an album that already has a tracklist, sorry!"}
                      {/* The search is of the mirror, which can be behind Wikidata. Refreshing needs a login. */}
                      {user && refreshing?.status !== "done" && (
                        <>
                          {" "}
                          If you updated the item on Wikidata,{" "}
                          <button
                            type="button"
                            className="link"
                            // Not disabled, which would drop focus while it's busy.
                            aria-disabled={refreshing?.status === "busy"}
                            onClick={() => refreshing?.status !== "busy" && refresh(i.qid)}
                          >
                            {refreshing?.status === "busy" ? "refreshing…" : "you can refresh it"}
                          </button>
                          .
                        </>
                      )}
                    </span>
                  )}
                  {refreshing?.status === "failed" && (
                    <span className="search-result-err" role="alert">
                      {refreshing.error}
                    </span>
                  )}
                </span>
                <span className="search-result-actions">
                  <button
                    type="button"
                    className={i.qid === first ? undefined : "ghost"}
                    disabled={tracks > 0}
                    aria-label={`Use ${label} (${i.qid})`}
                    aria-describedby={tracks ? `${id}-${i.qid}-err` : undefined}
                    onClick={() =>
                      update((s) => {
                        s.album.mode = "existing";
                        s.album.qid = i.qid;
                        s.start = "search";
                      })
                    }
                  >
                    Use this {type === "EP" ? "EP" : "album"}
                  </button>
                  {tracks > 0 && (
                    <a href={`${wikiBaseUrl}/wiki/${i.qid}`} target="_blank" rel="noreferrer">
                      View on Wikidata ↗
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!(items && items.length === 0) && (
        <span className="sub">
          Not listed?{" "}
          <button type="button" className="link" onClick={() => create(typed)}>
            Create it as a new album
          </button>
          .
        </span>
      )}
    </div>
  );
}

/** The basics of a new album. The rest of it is filled in in the Album section. */
function NewPanel({ state, update }: Omit<SectionProps, "plan">) {
  const A = state.album;
  return (
    <div className="start-panel">
      <div className="grid">
        <label className="f">
          Title
          <input
            type="text"
            value={A.title}
            onChange={(e) => update((s) => void (s.album.title = e.target.value))}
          />
        </label>
        <ArtistChips state={state} update={update} />
        <AlbumTypeSelect state={state} update={update} />
      </div>
      <span className="sub">
        Form, identifiers and the description template come next in the Album section.
      </span>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            update((s) => {
              s.album.mode = "create";
              s.start = "new";
            })
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
