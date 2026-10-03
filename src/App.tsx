import { useCallback, useEffect, useMemo, useState } from "react";
import AuthBar from "./AuthBar.tsx";
import { buildPlan, type State } from "./lib/plan.ts";
import { coerceState, EMPTY, EXAMPLE } from "./lib/state.ts";
import AlbumSection from "./components/AlbumSection.tsx";
import SettingsSection from "./components/SettingsSection.tsx";
import PerformersSection from "./components/PerformersSection.tsx";
import DiscsSection from "./components/DiscsSection.tsx";
import RunSection from "./components/RunSection.tsx";
import type { Update } from "./components/types.ts";

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
      <p className="flow">album —P658→ track —P2550→ composition · single —P658→ track</p>
      <div className="row example">
        <ConfirmButton
          className="ghost"
          label="Load the example"
          confirm={!isEmpty(state)}
          onConfirm={() => setState(structuredClone(EXAMPLE))}
        />
        <span className="hint">A filled-in album, to see how the form works.</span>
      </div>
      <AlbumSection {...props} />
      <SettingsSection {...props} />
      <DiscsSection {...props} />
      <PerformersSection {...props} />
      <RunSection {...props} />
      <div className="row" style={{ marginBottom: 24 }}>
        <ConfirmButton
          className="danger"
          label="Clear the form"
          confirm={!isEmpty(state)}
          onConfirm={() => setState(structuredClone(EMPTY))}
        />
      </div>
      <footer>
        <a href="https://github.com/connorshea/wikidata-discographer">Source</a> · MIT License
      </footer>
    </main>
  );
}

/** A button that replaces the form, needing a second click to confirm when
 * that would throw away what's filled in. */
function ConfirmButton({
  label,
  className,
  confirm,
  onConfirm,
}: {
  label: string;
  className: string;
  confirm: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (confirm && !armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? "Click again to confirm" : label}
    </button>
  );
}
