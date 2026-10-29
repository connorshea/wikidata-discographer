import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation, useRoute, useSearch } from "wouter";
import AuthBar from "./AuthBar.tsx";
import { loginHref, useAuth, useLoggedOut } from "./lib/auth-context.ts";
import { buildPlan, QID, releaseNoun, type State } from "./lib/plan.ts";
import { artistStart, existingAlbum } from "./lib/artist-start.ts";
import { coerceState, EMPTY } from "./lib/state.ts";
import { useStorageEvent } from "./components/use-storage-event.ts";
import AlbumSection from "./components/AlbumSection.tsx";
import SettingsSection from "./components/SettingsSection.tsx";
import PerformersSection from "./components/PerformersSection.tsx";
import DiscsSection from "./components/DiscsSection.tsx";
import MatchesSection, { type MatchesHandle } from "./components/MatchesSection.tsx";
import { useMatches } from "./components/use-matches.ts";
import { moveRowIds, reviewTracks } from "./lib/matches.ts";
import { createCounts, railSteps, type RunningInfo, runChecks } from "./lib/progress.ts";
import RunSection from "./components/RunSection.tsx";
import type { Update } from "./components/types.ts";
import { useAlbumTracklist } from "./components/use-album-tracklist.ts";
import ProgressRail from "./components/ProgressRail.tsx";
import PlanPanel from "./components/PlanPanel.tsx";
import StartSection, { type StartHandle } from "./components/StartSection.tsx";
import { albumProblem, existingSingle, useItemSummaries } from "./components/use-item-summaries.ts";
import AlbumList from "./components/AlbumList.tsx";
import ArtistPage from "./components/ArtistPage.tsx";
import { Lock } from "./components/common.tsx";
import { LockedContext } from "./lib/lock-context.ts";

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

/** The form's id, a new one if `fresh`, and a function that gives it a new one. */
function useFormId(fresh: boolean): [string, () => void] {
  const [id, setId] = useState(() => {
    if (fresh) return newFormId();
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
      </section>
      <section className="block locked-step" id="tracks">
        <h2>Tracks</h2>
      </section>
      <section className="block locked-step" id="performers">
        <h2>People</h2>
      </section>
    </div>
  );
}

/** A header link, marked as the current page while it's open, or any page `match` matches. */
function NavLink({ href, match, children }: { href: string; match?: string; children: string }) {
  const [active] = useRoute(match ?? href);
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
      {/* Light catching the grooves. The stop colors are set per theme in the CSS. */}
      <defs>
        <linearGradient id="record-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop className="sheen-hi" offset="0" />
          <stop className="sheen-mid" offset="0.45" />
          <stop className="sheen-mid" offset="0.55" />
          <stop className="sheen-lo" offset="1" />
        </linearGradient>
      </defs>
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
          <NavLink href="/artists" match="/artists/*?">
            Artists
          </NavLink>
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

/**
 * Above the form while logged out. Every API endpoint it uses needs a login, so
 * the form below is shown dimmed and can't be used until then.
 */
function LoginBanner() {
  const { configured, sessionEnded } = useAuth();
  const loggedOut = useLoggedOut();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loginRef = useRef<HTMLAnchorElement>(null);
  // A session that ends makes the form inert, which drops the focus of anyone
  // working in it. It goes to the login instead, so it isn't lost.
  useEffect(() => {
    if (!sessionEnded) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("[inert]")) return;
    (loginRef.current ?? headingRef.current)?.focus();
  }, [sessionEnded]);
  // The live region is always there, even empty, so a screen reader announces
  // the banner when a session ends: one added along with its text isn't read.
  return (
    <div role="status">
      {loggedOut && (
        <div className="login-banner">
          <div>
            <h2 ref={headingRef} tabIndex={-1}>
              {sessionEnded ? "Your session has ended" : "Log in to use Discographer"}
            </h2>
            <p>
              {sessionEnded
                ? "Log in again to carry on."
                : "You need to log in with your Wikidata account to search, import, or make edits."}
            </p>
          </div>
          {configured ? (
            <a ref={loginRef} className="btn" href={loginHref()}>
              Log in with Wikimedia
            </a>
          ) : (
            <p className="msg err">Login isn't configured on this server.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();
  return (
    <Switch>
      <Route path="/">
        {/* Form decides on mount whether it's logged out, so it waits for that to be known. */}
        {loading ? <Header /> : <Form />}
      </Route>
      <Route path="/albums">
        <Header />
        <main className="page">
          <AlbumList />
          <Footer />
        </main>
      </Route>
      <Route path="/artists/:qid?">
        {(params) => <ArtistRoute qid={params.qid?.toUpperCase() ?? null} />}
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

/** The artist page. Like the form, it needs a login, so it's dimmed until then. */
function ArtistRoute({ qid }: { qid: string | null }) {
  const loggedOut = useLoggedOut();
  return (
    <>
      <Header />
      <main className="page narrow">
        <LoginBanner />
        <div className={loggedOut ? "logged-out" : undefined} inert={loggedOut}>
          <ArtistPage qid={qid && QID.test(qid) ? qid : null} />
        </div>
        <Footer />
      </main>
    </>
  );
}

/** The form for an album's tracklist, and the run that puts it on Wikidata. */
function Form() {
  const loggedOut = useLoggedOut();
  // Logged out when the page loaded, the form is shown empty, as filling it in
  // would ask the API about it. The saved form is left as it is for after the
  // login. One whose session ends while it's open keeps what it has.
  const [preview] = useState(loggedOut);
  const search = useSearch();
  const [, navigate] = useLocation();
  const [fromArtist] = useState(() => (preview ? null : artistStart(search)));
  // A plain album replaces the form, as a MusicBrainz load does. A release
  // group goes through the MusicBrainz picker, which replaces it once a
  // release is loaded.
  const [state, setState] = useState<State>(() =>
    preview
      ? structuredClone(EMPTY)
      : fromArtist && !fromArtist.rg
        ? existingAlbum(fromArtist.album)
        : loadState(),
  );
  const [formId, renewFormId] = useFormId(!!fromArtist && !fromArtist.rg);
  useEffect(() => {
    if (!new URLSearchParams(search).has("album")) return;
    navigate("/", { replace: true });
    // The link may come from far down the artist page: start at the top.
    window.scrollTo({ top: 0 });
  }, [search, navigate]);
  // Clear also starts the import afresh, without the last load's summary.
  const [clears, setClears] = useState(0);
  // Candidates dismissed in the Possible matches card, by candidateId.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  // Clear and a MusicBrainz import start a new form, with nothing dismissed in it.
  const replace = useCallback(
    (next: State) => {
      setState(next);
      setDismissed(new Set());
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
  const stale = !preview && otherTab !== null;
  useStorageEvent(STORAGE_KEY, (saved) => {
    if (!saved) return;
    try {
      setOtherTab(JSON.stringify(coerceState(JSON.parse(saved))));
    } catch {
      // corrupt: nothing to compare with
    }
  });
  useEffect(() => {
    if (stale || preview) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked; the form still works
    }
  }, [state, stale, preview]);

  const {
    tracklist: albumTracklist,
    releaseGroup,
    checked,
    pending: tracklistPending,
    reload: reloadTracklist,
  } = useAlbumTracklist(state);
  const existingQid = state.album.mode === "existing" ? state.album.qid.trim() : "";
  const lookupAlbum = useItemSummaries([existingQid], state.settings.lang);
  const albumFound = lookupAlbum(existingQid);
  // Record what Wikidata says the existing release is once it's been asked, so the plan, the
  // server and the run all call a single one. A QID still being looked up, or whose lookup
  // failed, keeps what it had.
  const singleQid = existingSingle(existingQid, albumFound) ? existingQid : "";
  const albumKnown =
    !existingQid ||
    (!!albumFound && albumFound.status !== "loading" && albumFound.status !== "failed");
  if (albumKnown && state.album.singleQid !== singleQid)
    update((s) => {
      s.album.singleQid = singleQid;
    });
  const startRef = useRef<StartHandle>(null);
  const loadedRg = useRef(false);
  useEffect(() => {
    if (!fromArtist?.rg || loadedRg.current) return;
    loadedRg.current = true;
    startRef.current?.loadReleaseGroup(fromArtist.rg, fromArtist.album);
  }, [fromArtist]);
  const matchesRef = useRef<MatchesHandle>(null);
  const { matches, status } = useMatches(state, plan);
  const reviews = reviewTracks(state.discs, plan.tracks, matches, dismissed);
  const props = { state, update, plan };
  const { user } = useAuth();
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [sideSlot, setSideSlot] = useState<HTMLDivElement | null>(null);
  const [running, setRunning] = useState<RunningInfo | null>(null);
  // The run's QIDs are being checked before it starts. It runs the form as it
  // was sent, and writes its QIDs back by row, so the form can't change meanwhile.
  const [starting, setStarting] = useState(false);
  const locked = !!running || starting;
  // A run on show, such as one opened from the album list, which Clear closes.
  const [showingRun, setShowingRun] = useState(false);
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
  const checks = runChecks({
    ...progress,
    ineligible: user && !user.eligibility.ok ? user.eligibility.reason : null,
    matchesPending: status === "pending",
    albumPending: tracklistPending || albumFound?.status === "loading",
  });
  return (
    <>
      <Header />
      <div className="page">
        <LoginBanner />
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
        <div className={loggedOut ? "shell logged-out" : "shell"} inert={loggedOut}>
          <ProgressRail
            steps={railSteps(progress)}
            noun={releaseNoun(state.album)}
            locked={locked}
            empty={empty && !showingRun}
            // An empty form loses nothing, so closing the run needs no asking.
            clearConfirm={
              empty
                ? null
                : {
                    title: "Clear the form?",
                    body: "This removes the release, settings, tracklists, and performers you've entered. It can't be undone.",
                    action: "Clear the form",
                  }
            }
            onClear={clear}
          />
          <main className="steps">
            <LockedContext.Provider value={locked}>
              {running ? (
                <p className="msg">
                  The form is locked while the run makes its edits. You can change it again once the
                  run finishes.
                </p>
              ) : (
                starting && <p className="msg">The form is locked while the run starts.</p>
              )}
              <Lock>
                <StartSection
                  key={clears}
                  ref={startRef}
                  {...props}
                  albumLabel={albumFound?.status === "ok" ? albumFound.label : null}
                  onLoad={replace}
                />
              </Lock>
              {state.start ? (
                <>
                  <Lock>
                    <AlbumSection
                      {...props}
                      found={albumFound}
                      albumTracklist={albumTracklist}
                      checked={checked}
                      releaseGroup={releaseGroup}
                      reloading={albumFound?.status === "loading" || tracklistPending}
                      onReload={() => {
                        lookupAlbum.reload(existingQid);
                        reloadTracklist();
                      }}
                      onLoadReleaseGroup={(mbid, album) =>
                        startRef.current?.loadReleaseGroup(mbid, album)
                      }
                      onPickAnother={() =>
                        startRef.current?.change(state.start === "search" ? "search" : "existing")
                      }
                    />
                  </Lock>
                  {/* Picking a starting point doesn't collapse it, only a filled-in form does. */}
                  <SettingsSection
                    key={formId}
                    {...props}
                    startCollapsed={!isEmpty({ ...state, start: null })}
                  />
                  <DiscsSection
                    {...props}
                    reviews={reviews}
                    onRowsMoved={(move) => {
                      setDismissed((prev) => moveRowIds(prev, move));
                      matchesRef.current?.moveRows(move);
                    }}
                  />
                  <Lock>
                    <MatchesSection
                      key={formId}
                      ref={matchesRef}
                      {...props}
                      {...{ status, reviews, setDismissed }}
                    />
                  </Lock>
                  <Lock>
                    <PerformersSection {...props} />
                  </Lock>
                </>
              ) : (
                <LockedSteps />
              )}
              <RunSection
                {...props}
                // A run needs a login, which the checklist leaves to the banner.
                checklistDone={!!user && checks.every((c) => c.ok)}
                unreviewed={unreviewed}
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
                onStarting={setStarting}
                onShowing={setShowingRun}
              />
            </LockedContext.Provider>
          </main>
          <PlanPanel
            counts={createCounts(state, plan)}
            checks={checks}
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
