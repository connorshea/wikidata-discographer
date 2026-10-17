// "Planned edits": the plan as readable edits (src/lib/preview.ts), one card per
// edit in run order, filtered by item type. A card's statements are only
// rendered once it's opened.
import { useMemo, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { MUSICBRAINZ, type Plan, type State } from "../lib/plan.ts";
import {
  type PreviewEdit,
  type PreviewKind,
  type PreviewStatement,
  previewPlan,
  type PreviewValue,
} from "../lib/preview.ts";

/** Cards shown before "Show N more". */
const FIRST = 8;

const KINDS: readonly { kind: PreviewKind; label: string; name: string; edge: string }[] = [
  { kind: "track", label: "Tracks", name: "track", edge: "trk-edge" },
  { kind: "comp", label: "Compositions", name: "composition", edge: "cmp-edge" },
  { kind: "album", label: "Album", name: "album", edge: "disc-edge" },
  { kind: "single", label: "Singles", name: "single", edge: "rg-edge" },
];
const KIND = new Map(KINDS.map((k) => [k.kind, k]));

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function PlannedEdits({ plan, state }: { plan: Plan; state: State }) {
  const edits = useMemo(
    () =>
      previewPlan(plan, state)
        .flatMap((g) => g.edits)
        .toSorted((a, b) => a.n - b.n),
    [plan, state],
  );
  const [filter, setFilter] = useState<PreviewKind | "all">("all");
  const [more, setMore] = useState(false);
  const count = (kind: PreviewKind) => edits.filter((e) => e.kind === kind).length;
  // Singles only get a filter when there are any.
  const filters = KINDS.filter((k) => k.kind !== "single" || count("single") > 0);
  // A filter left with nothing in it, e.g. the singles were unticked, shows them all again.
  const active = filter !== "all" && count(filter) ? filter : "all";
  const list = active === "all" ? edits : edits.filter((e) => e.kind === active);
  const shown = more ? list : list.slice(0, FIRST);
  const pick = (f: PreviewKind | "all") => {
    setFilter(f);
    setMore(false);
  };
  return (
    <section className="block planned" aria-labelledby="planned-title">
      <div className="planned-head">
        <h2 id="planned-title">Planned edits</h2>
        <div className="planned-filters" role="group" aria-label="Filter by item type">
          <button type="button" aria-pressed={active === "all"} onClick={() => pick("all")}>
            All {edits.length}
          </button>
          {filters.map((k) => (
            <button
              key={k.kind}
              type="button"
              aria-pressed={active === k.kind}
              disabled={!count(k.kind)}
              onClick={() => pick(k.kind)}
            >
              <i className="sw" style={{ background: `var(--${k.edge})` }} aria-hidden="true" />
              {k.label} {count(k.kind)}
            </button>
          ))}
        </div>
      </div>
      <ul className="planned-list">
        {shown.map((e) => (
          <EditCard key={e.n} edit={e} />
        ))}
      </ul>
      {shown.length < list.length && (
        <button type="button" className="ghost wide" onClick={() => setMore(true)}>
          Show {list.length - shown.length} more
        </button>
      )}
    </section>
  );
}

/** What the card's pill says: what the edit does to its item. */
function action(edit: PreviewEdit): string {
  const name = KIND.get(edit.kind)!.name;
  if (edit.creates) return `New ${edit.heading.startsWith("Create EP") ? "EP" : name}`;
  return edit.kind === "album" ? "Adds statements" : `Reused ${name}`;
}

function EditCard({ edit }: { edit: PreviewEdit }) {
  const [open, setOpen] = useState(false);
  const n = edit.statements.length;
  return (
    <li>
      <details
        className="planned-card"
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <i
            className="sw"
            style={{ background: `var(--${KIND.get(edit.kind)!.edge})` }}
            aria-hidden="true"
          />
          <b>{edit.title}</b>
          <span className="pill">{action(edit)}</span>
          {edit.place && (
            <span className="muted">
              Disc {edit.place.disc} · {edit.place.n}
            </span>
          )}
          <span className="planned-count">{plural(n, "statement")}</span>
        </summary>
        {open && (
          <div className="planned-body">
            {edit.target && (
              <p className="hint">
                Adds to <Val v={edit.target} />
              </p>
            )}
            <dl className="planned-st">
              {edit.terms.map((t, i) => (
                <div key={`t${i}`}>
                  <dt>
                    {t.kind} <span className="planned-lang">{t.language}</span>
                  </dt>
                  <dd>{t.text}</dd>
                </div>
              ))}
              {edit.statements.map((s, i) => (
                <Statement key={i} s={s} />
              ))}
            </dl>
          </div>
        )}
      </details>
    </li>
  );
}

function Statement({ s }: { s: PreviewStatement }) {
  const fromMb = s.references.some((r) => r.some((q) => q.value.qid === MUSICBRAINZ));
  return (
    <div>
      <dt>
        {s.property.label ?? s.property.id}{" "}
        {s.property.label && <span className="mono">{s.property.id}</span>}
      </dt>
      <dd>
        <span className="planned-val">
          <Val v={s.value} />
          {s.value.reused && <span className="pill ok">reused</span>}
          {s.ifMissing && <span className="muted">unless it already has one</span>}
          {fromMb && <span className="mb-badge">MB</span>}
          {s.references.map((r, j) => (
            <span key={j} className="muted planned-ref">
              {r.map((q) => `${q.property.label ?? q.property.id} ${q.value.text}`).join(", ")}
            </span>
          ))}
        </span>
        {s.qualifiers.length > 0 && (
          <span className="muted planned-quals">
            {s.qualifiers.map((q, j) => (
              <span key={j}>
                {j > 0 && " · "}
                {q.property.label ?? q.property.id} <Val v={q.value} />
              </span>
            ))}
          </span>
        )}
      </dd>
    </div>
  );
}

function Val({ v }: { v: PreviewValue }) {
  const { wikiBaseUrl } = useAuth();
  if (v.isNew) return <i>{v.text}</i>;
  if (!v.qid) return <>{v.text}</>;
  const link = (
    <a
      className="mono planned-qid"
      href={`${wikiBaseUrl}/wiki/${v.qid}`}
      target="_blank"
      rel="noreferrer"
    >
      {v.qid}
    </a>
  );
  if (v.text === v.qid) return link;
  return (
    <>
      {v.text} {link}
    </>
  );
}
