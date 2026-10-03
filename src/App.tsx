import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import AuthBar from "./AuthBar.tsx";
import { useAuth } from "./lib/auth-context.ts";
import { PROPERTY_LABELS } from "./lib/preview.ts";
import { buildPlan, type State } from "./lib/plan.ts";
import { coerceState, EMPTY, EXAMPLE } from "./lib/state.ts";
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

/** Whether the form is as Clear leaves it, so replacing it loses nothing. */
const isEmpty = (s: State) => JSON.stringify(coerceState(s)) === JSON.stringify(coerceState(EMPTY));

export default function App() {
  const [state, setState] = useState<State>(loadState);
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
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked; the form still works
    }
  }, [state]);

  const albumTracklist = useAlbumTracklist(state);
  const { matches, status } = useMatches(state, plan);
  // Candidates dismissed in the Possible matches card, by candidateId.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const reviews = reviewTracks(state.discs, plan.parsed, matches, dismissed);
  const props = { state, update, plan };
  return (
    <main>
      <header className="top">
        <div>
          <h1>Wikidata Discographer</h1>
          <p className="lede">
            Turn an album's tracklist into Wikidata items: the album, a composition and a track for
            each song, and any singles, all linked together and made with your account.
          </p>
        </div>
        <AuthBar />
      </header>
      <ItemModel />
      <div className="row example">
        <ConfirmButton
          className="ghost"
          label="Load the example"
          confirm={
            isEmpty(state)
              ? null
              : {
                  title: "Replace the form with the example?",
                  body: "This replaces everything you've entered with the example album. It can't be undone.",
                  action: "Replace",
                }
          }
          onConfirm={() => setState(structuredClone(EXAMPLE))}
        />
        <span className="hint">A filled-in album, to see how the form works.</span>
      </div>
      <AlbumSection {...props} albumTracklist={albumTracklist} />
      <SettingsSection {...props} />
      <DiscsSection {...props} reviews={reviews} />
      <MatchesSection {...props} {...{ matches, status, reviews, dismissed, setDismissed }} />
      <PerformersSection {...props} />
      <RunSection {...props} albumTracklist={albumTracklist} />
      <div className="row" style={{ marginBottom: 24 }}>
        <ConfirmButton
          className="danger"
          label="Clear the form"
          confirm={
            isEmpty(state)
              ? null
              : {
                  title: "Clear the form?",
                  body: "This removes the album, settings, tracklists and performers you've entered. It can't be undone.",
                  action: "Clear the form",
                }
          }
          onConfirm={() => setState(structuredClone(EMPTY))}
        />
      </div>
      <footer>
        <a href="https://github.com/connorshea/wikidata-discographer">Source</a> · MIT License
      </footer>
    </main>
  );
}

/** A button that replaces the form, asking first in a modal dialog when that
 * would throw away what's filled in. */
function ConfirmButton({
  label,
  className,
  confirm,
  onConfirm,
}: {
  label: string;
  className: string;
  confirm: { title: string; body: string; action: string } | null;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        onClick={() => {
          if (!confirm) return onConfirm();
          dialog.current?.showModal();
          // Enter on the default focus shouldn't destroy anything.
          cancel.current?.focus();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => button.current?.focus()}
        // A click on the backdrop lands on the <dialog> itself; its contents are
        // wrapped in a div that fills it, so clicks inside never do.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {confirm && (
          <div className="confirm-body">
            <h2 id={titleId}>{confirm.title}</h2>
            <p id={bodyId}>{confirm.body}</p>
            <div className="row">
              <button ref={cancel} type="button" className="ghost" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  close();
                  onConfirm();
                }}
              >
                {confirm.action}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
