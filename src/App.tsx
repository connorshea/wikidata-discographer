import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useRoute } from "wouter";
import AuthBar from "./AuthBar.tsx";
import { useAuth } from "./lib/auth-context.ts";
import { PROPERTY_LABELS } from "./lib/preview.ts";
import { buildPlan, type State } from "./lib/plan.ts";
import { coerceState, EMPTY } from "./lib/state.ts";
import { useStorageEvent } from "./components/use-storage-event.ts";
import AlbumSection from "./components/AlbumSection.tsx";
import SettingsSection from "./components/SettingsSection.tsx";
import PerformersSection from "./components/PerformersSection.tsx";
import DiscsSection from "./components/DiscsSection.tsx";
import MatchesSection from "./components/MatchesSection.tsx";
import { useMatches } from "./components/use-matches.ts";
import { reviewTracks } from "./lib/matches.ts";
import RunSection from "./components/RunSection.tsx";
import type { Update } from "./components/types.ts";
import { useAlbumTracklist } from "./components/use-album-tracklist.ts";
import { ConfirmButton } from "./components/ConfirmDialog.tsx";
import MusicBrainzImport, {
  type MusicBrainzImportHandle,
} from "./components/MusicBrainzImport.tsx";
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

/** An item type's name with its colour swatch. */
function Kind({ edge, children }: { edge: string; children: string }) {
  return (
    <b className="kind">
      <i style={{ background: `var(--${edge})` }} />
      {children}
    </b>
  );
}

/** A property's plain name, linked to its page, with its ID on hover. */
function Prop({ id, children }: { id: string; children: string }) {
  const { wikiBaseUrl } = useAuth();
  return (
    <a
      className="prop"
      href={`${wikiBaseUrl}/wiki/Property:${id}`}
      target="_blank"
      rel="noreferrer"
      title={`${PROPERTY_LABELS[id]} (${id})`}
    >
      {children}
    </a>
  );
}

/** How the items the app makes link together, in words. */
function ItemModel() {
  return (
    <ul className="flow" aria-label="How the items are linked">
      <li>
        <Kind edge="disc-edge">Album</Kind> <Prop id="P658">lists</Prop>{" "}
        <Kind edge="trk-edge">tracks</Kind>, each a <Prop id="P2550">recording of</Prop> a{" "}
        <Kind edge="cmp-edge">composition</Kind>
      </li>
      <li>
        <Kind edge="rg-edge">Singles</Kind> <Prop id="P658">list</Prop> a track and are{" "}
        <Prop id="P13602">taken from</Prop> the album
      </li>
    </ul>
  );
}

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

  const { tracklist: albumTracklist, releaseGroup } = useAlbumTracklist(state);
  const mbImport = useRef<MusicBrainzImportHandle>(null);
  const { matches, status } = useMatches(state, plan);
  // Candidates dismissed in the Possible matches card, by candidateId.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const reviews = reviewTracks(state.discs, plan.tracks, matches, dismissed);
  const props = { state, update, plan };
  return (
    <>
      <Header />
      <main className="page">
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
        <ItemModel />
        <MusicBrainzImport
          key={clears}
          ref={mbImport}
          state={state}
          needsConfirm={!isEmpty(state)}
          onLoad={replace}
        />
        <AlbumSection
          {...props}
          albumTracklist={albumTracklist}
          releaseGroup={releaseGroup}
          onLoadReleaseGroup={(mbid, album) => mbImport.current?.loadReleaseGroup(mbid, album)}
        />
        <SettingsSection {...props} />
        <DiscsSection {...props} reviews={reviews} />
        <MatchesSection {...props} {...{ matches, status, reviews, dismissed, setDismissed }} />
        <PerformersSection {...props} />
        <RunSection
          {...props}
          albumTracklist={albumTracklist}
          unreviewed={reviews.filter((r) => !r.reviewed).length}
          matchesPending={status === "pending"}
          formId={formId}
          stale={stale}
          onFinished={clear}
        />
        <div className="row" style={{ marginBottom: 24 }}>
          <ConfirmButton
            className="danger"
            label="Clear the form"
            confirm={
              isEmpty(state)
                ? null
                : {
                    title: "Clear the form?",
                    body: "This removes the album, settings, tracklists, and performers you've entered. It can't be undone.",
                    action: "Clear the form",
                  }
            }
            onConfirm={clear}
          />
        </div>
        <Footer />
      </main>
    </>
  );
}
