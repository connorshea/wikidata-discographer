import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useRoute } from "wouter";
import AuthBar from "./AuthBar.tsx";
import { useAuth } from "./lib/auth-context.ts";
import { buildPlan, type State } from "./lib/plan.ts";
import { coerceState, EMPTY } from "./lib/state.ts";
import { useStorageEvent } from "./components/use-storage-event.ts";
import AlbumSection from "./components/AlbumSection.tsx";
import SettingsSection from "./components/SettingsSection.tsx";
import PerformersSection from "./components/PerformersSection.tsx";
import DiscsSection from "./components/DiscsSection.tsx";
import MatchesSection from "./components/MatchesSection.tsx";
import { useMatches } from "./components/use-matches.ts";
import { renumberDismissed, reviewTracks } from "./lib/matches.ts";
import { createCounts, railSteps, type RunningInfo, runChecks } from "./lib/progress.ts";
import RunSection from "./components/RunSection.tsx";
import type { Update } from "./components/types.ts";
import { useAlbumTracklist } from "./components/use-album-tracklist.ts";
import ProgressRail from "./components/ProgressRail.tsx";
import PlanPanel from "./components/PlanPanel.tsx";
import StartSection, { type StartHandle } from "./components/StartSection.tsx";
import { albumProblem, useItemSummaries } from "./components/use-item-summaries.ts";
import AlbumList from "./components/AlbumList.tsx";

/**
 * The ID Wikidata gave the production OAuth consumer when it was registered,
 * listed on Special:OAuthListConsumers. MediaWiki tags every edit made through it
 * with "OAuth CID: <id>". A local or test consumer gets a different ID, but only
 * the production consumer's edits are worth linking to.
 */
const OAUTH_CONSUMER_ID = 19583;

/** Every user's edits through the tool in the last 30 days, grouped by page. */
const RECENT_CHANGES_URL = `https://www.wikidata.org/w/index.php?${new URLSearchParams({
  title: "Special:RecentChanges",
  tagfilter: `OAuth CID: ${OAUTH_CONSUMER_ID}`,
  hidecategorization: "1",
  enhanced: "1",
  urlversion: "2",
})}`;

const STORAGE_KEY = "discographer:state";

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return coerceState(JSON.parse(raw));
  } catch {
    // unavailable or corrupt: start fresh
  }
  return structuredClone(EMPTY);
}

// Identifies the form until it's cleared or replaced, so a run's QIDs only go
// back into the form it started from (src/components/RunSection.tsx).
const FORM_ID_KEY = "discographer:formId";

// Not crypto.randomUUID, which only exists on HTTPS and localhost.
const newFormId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The form's id, and a function that gives it a new one. */
function useFormId(): [string, () => void] {
  const [id, setId] = useState(() => {
    try {
      const saved = localStorage.getItem(FORM_ID_KEY);
      if (saved) return saved;
    } catch {
      // unavailable: a new id for this page load
    }
    return newFormId();
  });
  useEffect(() => {
    try {
      localStorage.setItem(FORM_ID_KEY, id);
    } catch {
      // storage blocked; the id lasts for this page load
    }
  }, [id]);
  return [id, useCallback(() => setId(newFormId()), [])];
}

/** Whether the form is as Clear leaves it, so replacing it loses nothing. */
const isEmpty = (s: State) => JSON.stringify(coerceState(s)) === JSON.stringify(coerceState(EMPTY));

/** Where the later steps stand until a starting point is picked: locked, with nothing to fill in. */
function LockedSteps() {
  return (
    <div className="locked" aria-disabled="true">
      <p className="locked-note">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" />
          <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" />
        </svg>
        Pick a starting point first
      </p>
      <section className="block locked-step" id="settings">
        <h2>Item settings</h2>
        <button type="button" className="ghost" disabled>
          Show all settings
        </button>
      </section>
      <section className="block locked-step" id="tracks">
        <h2>
          <span className="sw" aria-hidden="true" />
          Tracks
        </h2>
        <button type="button" className="link" disabled>
          Add a tracklist →
        </button>
      </section>
      <section className="block locked-step" id="performers">
        <h2>Performers</h2>
      </section>
    </div>
  );
}

/** A header link, marked as the current page while it's open. */
function NavLink({ href, children }: { href: string; children: string }) {
  const [active] = useRoute(href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** A record, for the wordmark. */
function RecordIcon() {
  return (
    <svg className="record-icon" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle className="vinyl" cx="14" cy="14" r="13" />
      <circle className="groove" cx="14" cy="14" r="8.5" />
      <circle className="label" cx="14" cy="14" r="4.5" />
      <circle className="hole" cx="14" cy="14" r="1.4" />
    </svg>
  );
}

/** The wordmark, with the links between pages and the login control. */
function Header() {
  return (
    <header className="top">
      <div className="top-inner">
        <h1 className="wordmark">
          <Link href="/">
            <RecordIcon />
            <span className="name">Discographer</span> <span className="for">for Wikidata</span>
          </Link>
        </h1>
        <nav className="top-nav" aria-label="Pages">
          <NavLink href="/">New album</NavLink>
          <NavLink href="/albums">Albums</NavLink>
          <a
            href={RECENT_CHANGES_URL}
            target="_blank"
            rel="noreferrer"
            title="Edits made with this tool in the last 30 days"
          >
            Recent edits ↗
          </a>
        </nav>
        <AuthBar />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <a href="https://github.com/connorshea/wikidata-discographer">Source</a> ·{" "}
      <a href={RECENT_CHANGES_URL} title="Edits made with this tool in the last 30 days">
        Recent changes
      </a>{" "}
      · MIT License
    </footer>
  );
}

export default function App() {
  return (
    <Switch>
      <Route path="/">
        <Form />
      </Route>
      <Route path="/albums">
        <Header />
        <main className="page">
          <AlbumList />
          <Footer />
        </main>
      </Route>
      <Route>
        <Header />
        <main className="page">
          <section className="block">
            <h2>Page not found</h2>
            <p className="hint">
              There's nothing here. Go to the <Link href="/">form</Link> or the{" "}
              <Link href="/albums">album list</Link>.
            </p>
          </section>
          <Footer />
        </main>
      </Route>
    </Switch>
  );
}

/** The form for an album's tracklist, and the run that puts it on Wikidata. */
function Form() {
  const [state, setState] = useState<State>(loadState);
  const [formId, renewFormId] = useFormId();
  // Clear also starts the import afresh, without the last load's summary.
  const [clears, setClears] = useState(0);
  // Clear and a MusicBrainz import start a new form.
  const replace = useCallback(
    (next: State) => {
      setState(next);
      renewFormId();
    },
    [renewFormId],
  );
  const clear = useCallback(() => {
    replace(structuredClone(EMPTY));
    setClears((n) => n + 1);
  }, [replace]);
  const plan = useMemo(() => buildPlan(state), [state]);
  const update = useCallback<Update>(
    (fn) =>
      setState((prev) => {
        const next = structuredClone(prev);
        fn(next);
        return next;
      }),
    [],
  );
  // The form another tab saved, while this tab's differs from it. Such a tab
  // is stale: it may lack QIDs a run wrote back there, so it neither runs nor
  // saves (which would undo the other tab's changes) until it's reloaded.
  const [otherTab, setOtherTab] = useState<string | null>(null);
  const json = useMemo(() => JSON.stringify(coerceState(state)), [state]);
  if (otherTab !== null && otherTab === json) setOtherTab(null);
  const stale = otherTab !== null;
  useStorageEvent(STORAGE_KEY, (saved) => {
    if (!saved) return;
    try {
      setOtherTab(JSON.stringify(coerceState(JSON.parse(saved))));
    } catch {
      // corrupt: nothing to compare with
    }
  });
  useEffect(() => {
    if (stale) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked; the form still works
    }
  }, [state, stale]);

  const {
    tracklist: albumTracklist,
    releaseGroup,
    checked,
    pending: tracklistPending,
  } = useAlbumTracklist(state);
  const existingQid = state.album.mode === "existing" ? state.album.qid.trim() : "";
  const lookupAlbum = useItemSummaries([existingQid], state.settings.lang);
  const albumFound = lookupAlbum(existingQid);
  const startRef = useRef<StartHandle>(null);
  const { matches, status } = useMatches(state, plan);
  // Candidates dismissed in the Possible matches card, by candidateId.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const reviews = reviewTracks(state.discs, plan.tracks, matches, dismissed);
  const props = { state, update, plan };
  const { user } = useAuth();
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [sideSlot, setSideSlot] = useState<HTMLDivElement | null>(null);
  const [running, setRunning] = useState<RunningInfo | null>(null);
  const empty = isEmpty(state);
  const unreviewed = reviews.filter((r) => !r.reviewed).length;
  const progress = {
    state,
    plan,
    empty,
    unreviewed,
    hasTracklist: !!albumTracklist,
    notAlbum: !!albumProblem(existingQid, albumFound),
    running,
  };
  return (
    <>
      <Header />
      <div className="page">
        {stale && (
          <div className="msg warn row">
            <span>
              The form was changed in another tab. Reload to get those changes. Until then this tab
              can't run, and what you change here isn't saved.
            </span>
            <button type="button" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        )}
        <div className="shell">
          <ProgressRail
            steps={railSteps(progress)}
            running={!!running}
            empty={empty}
            clearConfirm={{
              title: "Clear the form?",
              body: "This removes the album, settings, tracklists, and performers you've entered. It can't be undone.",
              action: "Clear the form",
            }}
            onClear={clear}
          />
          <main className="steps">
            <StartSection
              key={clears}
              ref={startRef}
              {...props}
              needsConfirm={!empty}
              albumLabel={albumFound?.status === "ok" ? albumFound.label : null}
              onLoad={replace}
            />
            {state.start ? (
              <>
                <AlbumSection
                  {...props}
                  found={albumFound}
                  albumTracklist={albumTracklist}
                  checked={checked}
                  releaseGroup={releaseGroup}
                  onLoadReleaseGroup={(mbid, album) =>
                    startRef.current?.loadReleaseGroup(mbid, album)
                  }
                  onPickAnother={() =>
                    startRef.current?.change(state.start === "search" ? "search" : "existing")
                  }
                />
                {/* Picking a starting point doesn't collapse it, only a filled-in form does. */}
                <SettingsSection
                  key={formId}
                  {...props}
                  startCollapsed={!isEmpty({ ...state, start: null })}
                />
                <DiscsSection
                  {...props}
                  reviews={reviews}
                  onRenumber={(di, moved) =>
                    setDismissed((prev) => renumberDismissed(prev, di, moved))
                  }
                />
                <MatchesSection
                  key={formId}
                  {...props}
                  {...{ matches, status, reviews, dismissed, setDismissed }}
                />
                <PerformersSection {...props} />
              </>
            ) : (
              <LockedSteps />
            )}
            <RunSection
              {...props}
              albumTracklist={albumTracklist}
              unreviewed={unreviewed}
              matchesPending={status === "pending"}
              formId={formId}
              stale={stale}
              onFinished={clear}
              slot={slot}
              sideSlot={sideSlot}
              albumName={
                state.album.mode === "create"
                  ? state.album.title.trim()
                  : (albumFound?.status === "ok" && albumFound.label) || existingQid
              }
              onRunning={setRunning}
            />
          </main>
          <PlanPanel
            counts={createCounts(state, plan)}
            checks={runChecks({
              ...progress,
              loggedIn: !!user,
              ineligible: user && !user.eligibility.ok ? (user.eligibility.reason ?? null) : null,
              matchesPending: status === "pending",
              albumPending: tracklistPending || albumFound?.status === "loading",
            })}
            slot={setSlot}
            sideSlot={setSideSlot}
            running={!!running}
          />
        </div>
        <Footer />
      </div>
    </>
  );
}
