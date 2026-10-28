// The panel beside the form: what the run will create, what still blocks it,
// and the run button, which RunSection renders into `slot`. During a run it
// only has what RunSection puts in `sideSlot`: this run, and the recent runs.
import type { Ref } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { PROPERTY_LABELS } from "../lib/preview.ts";
import type { Check, CreateCount } from "../lib/progress.ts";

/** An item type's name with its colour swatch. */
function Kind({ edge, children }: { edge: string; children: string }) {
  return (
    <b className="kind">
      <i className="sw" style={{ background: `var(--${edge})` }} />
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

/** How the items the app makes link together. */
function ItemModel() {
  return (
    <div className="model">
      <div className="kicker">Data model</div>
      <ul aria-label="How the items are linked">
        <li>
          <Kind edge="disc-edge">Album or single</Kind>{" "}
          <span>
            <Prop id="P658">lists</Prop> →
          </span>{" "}
          <Kind edge="trk-edge">Track</Kind>
        </li>
        <li>
          <Kind edge="trk-edge">Track</Kind>{" "}
          <span>
            <Prop id="P2550">recording of</Prop> →
          </span>{" "}
          <Kind edge="cmp-edge">Composition</Kind>
        </li>
      </ul>
    </div>
  );
}

function CheckIcon({ check }: { check: Check }) {
  if (check.ok)
    return (
      <svg className="check ok" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" />
        <path d="M4.8 8.2l2 2 4.2-4.4" />
      </svg>
    );
  // Amber only when something's wrong. Still to do is an empty circle.
  return (
    <svg
      className={`check ${check.problem ? "problem" : "todo"}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" />
      {check.problem && <path d="M8 4.6v4.2M8 11v.2" />}
    </svg>
  );
}

export default function PlanPanel({
  counts,
  checks,
  slot,
  sideSlot,
  running,
}: {
  counts: CreateCount[];
  checks: Check[];
  /** Where RunSection puts the run button. */
  slot: Ref<HTMLDivElement>;
  /** Where RunSection puts its cards. */
  sideSlot: Ref<HTMLDivElement>;
  running: boolean;
}) {
  const nothing = counts.every((c) => !c.count && !c.reused);
  return (
    <aside className="plan-panel" aria-label={running ? "Run" : "Plan"}>
      {!running && (
        <>
          <div className="card">
            <div className="kicker">This will create…</div>
            {nothing ? (
              <div className="plan-empty">
                <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                  <circle className="disc" cx="28" cy="28" r="26" />
                  <circle className="groove" cx="28" cy="28" r="18" />
                  <circle className="groove" cx="28" cy="28" r="12" />
                  <circle className="label" cx="28" cy="28" r="6" />
                  <circle className="hole" cx="28" cy="28" r="1.6" />
                </svg>
                <p>
                  Nothing yet. Pick an album or single and add a tracklist to see what will be
                  created.
                </p>
              </div>
            ) : (
              <ul className="counts">
                {counts.map((c) => (
                  <li key={c.kind}>
                    <i className="sw" style={{ background: `var(--${c.edge})` }} />
                    <span>{c.label}</span>
                    <b>
                      {c.count}
                      {c.reused > 0 && <span className="muted"> +{c.reused} reused</span>}
                    </b>
                  </li>
                ))}
              </ul>
            )}
            <ItemModel />
          </div>
          <div className="card">
            <ul className="checks-list">
              {checks.map((c) => (
                <li key={c.text} className={c.ok ? "ok" : c.problem ? "problem" : "todo"}>
                  <CheckIcon check={c} />
                  {c.ok ? (
                    <span>{c.text}</span>
                  ) : c.at ? (
                    <a href={`#${c.at}`}>{c.text}</a>
                  ) : (
                    <span>{c.text}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="run-slot" ref={slot} />
          </div>
        </>
      )}
      <div className="side-slot" ref={sideSlot} />
    </aside>
  );
}
