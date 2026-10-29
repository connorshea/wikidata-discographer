// The rail beside the form: a link to each step with its status, and the
// button that clears the form.
import { useEffect, useState } from "react";
import type { Step, StepId } from "../lib/progress.ts";
import { ConfirmButton, type Confirm } from "./ConfirmDialog.tsx";

/** The sections on the page, in order, with the step each belongs to. */
const SECTIONS: [string, StepId][] = [
  ["start", "start"],
  ["album", "album"],
  ["settings", "settings"],
  ["tracks", "tracks"],
  ["matches", "tracks"],
  ["performers", "performers"],
  ["create", "create"],
];

/** The step whose section is at the top of the window, as it scrolls. */
function useCurrentStep(): StepId {
  const [current, setCurrent] = useState<StepId>("start");
  useEffect(() => {
    let frame = 0;
    // A rail link jumps to its section, which may be too near the bottom to
    // reach the line: it stays current until the next scroll of the user's own.
    let jumped = 0;
    const measure = () => {
      frame = 0;
      if (performance.now() - jumped < 300) return;
      const line = window.innerHeight * 0.3;
      let step: StepId = "start";
      for (const [id, s] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) step = s;
      }
      // At the very bottom, the last section can't scroll up to the line.
      const bottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (bottom && window.scrollY > 0) step = SECTIONS[SECTIONS.length - 1][1];
      setCurrent(step);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onClick = (e: MouseEvent) => {
      const href = (e.target as Element).closest?.("a")?.getAttribute("href");
      const step = SECTIONS.find(([id]) => `#${id}` === href)?.[1];
      if (!step) return;
      jumped = performance.now();
      setCurrent(step);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick);
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return current;
}

function Lock() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2l2.3 2.3 4.7-5" />
    </svg>
  );
}

const STATUS_LABELS = { done: "Done", attention: "Needs attention", pending: "To do" };

export default function ProgressRail({
  steps,
  noun,
  locked,
  empty,
  clearConfirm,
  onClear,
}: {
  steps: Step[];
  /** What the release is called, "album" or "single". */
  noun: string;
  /** A run is starting or in progress, so the form can't be cleared. */
  locked: boolean;
  /** The form is already as Clear leaves it, with no run on show. */
  empty: boolean;
  clearConfirm: Confirm | null;
  onClear: () => void;
}) {
  const scrolled = useCurrentStep();
  // Scrolled down to a locked step, Start is still the one to do.
  const current = steps.find((s) => s.id === scrolled)?.locked ? "start" : scrolled;
  return (
    <nav className="rail" aria-label="Form sections">
      <div className="kicker">This {noun}</div>
      <ol>
        {steps.map((s, i) => {
          // A locked step is no link: its section has nothing to fill in yet.
          if (s.locked) {
            return (
              <li key={s.id}>
                <span className="rail-item locked" aria-disabled="true">
                  <span className="dot locked">
                    <Lock />
                    <span className="visually-hidden"> · Locked</span>
                  </span>
                  <span className="rail-text">
                    <b>{s.name}</b>
                    <span>{s.summary}</span>
                  </span>
                </span>
              </li>
            );
          }
          const isCurrent = s.id === current;
          const dot = s.status === "pending" && isCurrent ? "current" : s.status;
          return (
            <li key={s.id}>
              <a
                className="rail-item"
                href={`#${s.id}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className={`dot ${dot}`}>
                  {s.status === "done" ? <Check /> : i + 1}
                  <span className="visually-hidden"> · {STATUS_LABELS[s.status]}</span>
                </span>
                <span className="rail-text">
                  <b>{s.name}</b>
                  <span>{s.summary}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      <hr />
      <ConfirmButton
        className="danger clear-form"
        label="Clear form and start over"
        disabled={locked || empty}
        describedBy={locked ? "clear-hint" : undefined}
        confirm={clearConfirm}
        onConfirm={onClear}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" />
        </svg>
      </ConfirmButton>
      {locked && (
        <span className="hint" id="clear-hint">
          You can clear the form once the run finishes.
        </span>
      )}
    </nav>
  );
}
