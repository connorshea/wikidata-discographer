import { useCallback, useEffect, useMemo, useState } from "react";
import AuthBar from "./AuthBar.tsx";
import { buildPlan, type State } from "./lib/plan.ts";
import { coerceState, EMPTY, EXAMPLE } from "./lib/state.ts";
import AlbumSection from "./components/AlbumSection.tsx";
import SettingsSection from "./components/SettingsSection.tsx";
import PerformersSection from "./components/PerformersSection.tsx";
import DiscsSection from "./components/DiscsSection.tsx";
import type { Update } from "./components/types.ts";

const STORAGE_KEY = "discographer:state";

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return coerceState(JSON.parse(raw));
  } catch {
    // unavailable or corrupt: start fresh
  }
  return structuredClone(EXAMPLE);
}

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
      <AlbumSection {...props} />
      <SettingsSection {...props} />
      <DiscsSection {...props} />
      <PerformersSection {...props} />
      <ResetButtons onSet={(s) => setState(structuredClone(s))} />
      <footer>
        <a href="https://github.com/connorshea/wikidata-discographer">Source</a> · MIT License
      </footer>
    </main>
  );
}

/** Clear and load-the-example, each needing a second click to confirm. */
function ResetButtons({ onSet }: { onSet: (s: State) => void }) {
  const [armed, setArmed] = useState<"clear" | "example" | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const button = (which: "clear" | "example", label: string, target: State) => (
    <button
      type="button"
      className="danger"
      onClick={() => {
        if (armed !== which) return setArmed(which);
        setArmed(null);
        onSet(target);
      }}
    >
      {armed === which ? "Click again to confirm" : label}
    </button>
  );
  return (
    <div className="row" style={{ marginBottom: 24 }}>
      {button("clear", "Clear the form", EMPTY)}
      {button("example", "Load the example", EXAMPLE)}
    </div>
  );
}
