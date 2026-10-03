// Small form pieces shared by the sections.
import type { ReactNode } from "react";
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
  return (
    <span className={end ? "info end" : "info"}>
      <button type="button" aria-label={label} aria-describedby={`${id}-tip`}>
        i
      </button>
      <span role="tooltip" id={`${id}-tip`}>
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
