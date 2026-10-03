// "Preview the N edits": the plan as readable, grouped edits (src/lib/preview.ts),
// with the raw QuickStatements-like text behind a toggle. Closed sections
// render nothing, so a box set's hundreds of edits cost nothing until opened.
import { type ReactNode, useMemo, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { opsText, type Plan, type State } from "../lib/plan.ts";
import {
  type PreviewEdit,
  type PreviewProperty,
  previewPlan,
  type PreviewValue,
} from "../lib/preview.ts";

/** Groups start open when the whole plan is this small. */
const OPEN_UP_TO = 25;

/** A <details> whose contents are only rendered while it's open. */
function Lazy({
  summary,
  className,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={className}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{summary}</summary>
      {open && children()}
    </details>
  );
}

export default function PlanPreview({ plan, state }: { plan: Plan; state: State }) {
  const n = plan.ops.length;
  return (
    <Lazy summary={`Preview the ${n} edit${n === 1 ? "" : "s"}`}>
      {() => <PreviewBody plan={plan} state={state} />}
    </Lazy>
  );
}

function PreviewBody({ plan, state }: { plan: Plan; state: State }) {
  const groups = useMemo(() => previewPlan(plan, state), [plan, state]);
  const startOpen = plan.ops.length <= OPEN_UP_TO;
  return (
    <div className="preview">
      {groups.map((g) => (
        <Lazy
          key={g.id}
          className="pv-group"
          defaultOpen={startOpen}
          summary={
            <>
              {g.title}{" "}
              <span className="muted">
                ({g.edits.length} edit{g.edits.length === 1 ? "" : "s"})
              </span>
            </>
          }
        >
          {() => (
            <ul className="pv-edits">
              {g.edits.map((e) => (
                <Edit key={e.n} edit={e} />
              ))}
            </ul>
          )}
        </Lazy>
      ))}
      <Lazy summary="Show as QuickStatements" className="pv-group">
        {() => <RawText plan={plan} />}
      </Lazy>
    </div>
  );
}

function Edit({ edit }: { edit: PreviewEdit }) {
  return (
    <li>
      <div className="pv-head">
        <span className="pv-n">{edit.n}.</span> {edit.heading}
        {edit.target && (
          <span className="muted">
            {" "}
            · on <Val v={edit.target} />
          </span>
        )}
      </div>
      <ul className="pv-claims">
        {edit.terms.map((t, i) => (
          <li key={`t${i}`}>
            <span className="pv-prop">
              {t.kind} ({t.language})
            </span>{" "}
            {t.text}
          </li>
        ))}
        {edit.statements.map((s, i) => (
          <li key={i}>
            <Prop p={s.property} /> <Val v={s.value} />
            {s.qualifiers.length > 0 && (
              <ul className="pv-quals">
                {s.qualifiers.map((q, j) => (
                  <li key={j}>
                    <Prop p={q.property} /> <Val v={q.value} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Prop({ p }: { p: PreviewProperty }) {
  return (
    <span className="pv-prop" title={p.id}>
      {p.label ?? p.id}
    </span>
  );
}

function Val({ v }: { v: PreviewValue }) {
  const { wikiBaseUrl } = useAuth();
  if (v.isNew) return <span className="pv-new">{v.text}</span>;
  if (!v.qid) return <>{v.text}</>;
  const link = (
    <a href={`${wikiBaseUrl}/wiki/${v.qid}`} target="_blank" rel="noreferrer">
      {v.qid}
    </a>
  );
  if (v.text === v.qid) return link;
  return (
    <>
      {v.text} <span className="muted pv-id">({link})</span>
    </>
  );
}

function RawText({ plan }: { plan: Plan }) {
  const text = useMemo(() => opsText(plan.ops), [plan.ops]);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="row">
        <button
          type="button"
          className="ghost small"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="out">{text}</pre>
    </>
  );
}
