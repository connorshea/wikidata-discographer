// "Preview the N edits": the plan as readable, grouped edits (src/lib/preview.ts),
// all in one scroll box. Nothing is rendered until it's opened.
import { useMemo, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import type { Plan, State } from "../lib/plan.ts";
import {
  type PreviewEdit,
  type PreviewProperty,
  previewPlan,
  type PreviewValue,
} from "../lib/preview.ts";

export default function PlanPreview({ plan, state }: { plan: Plan; state: State }) {
  const [open, setOpen] = useState(false);
  const n = plan.ops.length;
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{`Preview the ${n} edit${n === 1 ? "" : "s"}`}</summary>
      {open && <PreviewBody plan={plan} state={state} />}
    </details>
  );
}

function PreviewBody({ plan, state }: { plan: Plan; state: State }) {
  const groups = useMemo(() => previewPlan(plan, state), [plan, state]);
  return (
    <div className="preview">
      {groups.map((g) => (
        <section key={g.id} className="pv-group">
          <h4>
            {g.title}{" "}
            <span className="muted">
              ({g.edits.length} edit{g.edits.length === 1 ? "" : "s"})
            </span>
          </h4>
          <ul className="pv-edits">
            {g.edits.map((e) => (
              <Edit key={e.n} edit={e} />
            ))}
          </ul>
        </section>
      ))}
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
