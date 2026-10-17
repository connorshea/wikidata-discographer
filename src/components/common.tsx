// Small form pieces shared by the sections.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { normalizeQid } from "../lib/plan.ts";
import { PROPERTY_LABELS } from "../lib/preview.ts";

export function FieldErr({ id, msg }: { id: string; msg?: string }) {
  return (
    <span className="field-err" id={`${id}-err`} aria-live="polite">
      {msg ?? ""}
    </span>
  );
}

/** A text input that turns a pasted Wikidata URL or "q123" into a bare QID. */
export function QidInput({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (qid: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      type="text"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(normalizeQid(e.target.value))}
      {...rest}
    />
  );
}

/**
 * An "i" button with a tooltip, shown while it's hovered or focused. The
 * tooltip is fixed and placed under the button, so a scrolling box around it,
 * such as the track table's, can't clip it.
 */
export function InfoTip({
  id,
  label = "Template variables",
  end = false,
  children,
}: {
  id: string;
  label?: string;
  /** Open the tooltip leftward, for an icon near the right edge. */
  end?: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = hovered || focused;
  const box = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const place = () => {
      const b = box.current?.getBoundingClientRect();
      const el = tip.current;
      if (!b || !el) return;
      const w = el.offsetWidth;
      const left = end ? b.right - w : b.left;
      el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
      el.style.top = `${b.bottom + 6}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown, end]);
  return (
    <span
      ref={box}
      className={shown ? "info shown" : "info"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={`${id}-tip`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        i
      </button>
      <span ref={tip} role="tooltip" id={`${id}-tip`}>
        {children}
      </span>
    </span>
  );
}

export function WikiLink({ base, qid }: { base: string; qid: string }) {
  return (
    <a href={`${base}/wiki/${qid}`} target="_blank" rel="noreferrer">
      {qid}
    </a>
  );
}

/**
 * Text with each QID it mentions linked to its item. A QID inside “curly
 * quotes” is part of a title or name, so it's left as text.
 */
export function Qids({ base, children }: { base: string; children: string }) {
  return (
    <>
      {children
        .split(/(“[^”]*”|\bQ\d+\b)/)
        .map((part, i) =>
          i % 2 && part.startsWith("Q") ? <WikiLink key={i} base={base} qid={part} /> : part,
        )}
    </>
  );
}

/**
 * Text with each property ID it mentions (P175, say) showing the property's name
 * on hover. One span, so a flex label lays it out as a single run of text.
 */
export function Pids({ children }: { children: string }) {
  return (
    <span>
      {children.split(/\b(P\d+)\b/).map((part, i) =>
        i % 2 && PROPERTY_LABELS[part] ? (
          <abbr key={i} className="pid" title={PROPERTY_LABELS[part]}>
            {part}
          </abbr>
        ) : (
          part
        ),
      )}
    </span>
  );
}
