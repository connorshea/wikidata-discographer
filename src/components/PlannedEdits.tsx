// "Planned edits": the plan as readable edits (src/lib/preview.ts), one card per
// edit in run order, filtered by item type. A card's statements are only
// rendered once it's opened.
import { useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import { MUSICBRAINZ } from "../lib/plan.ts";
import type { PreviewEdit, PreviewKind, PreviewStatement, PreviewValue } from "../lib/preview.ts";

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

/** `edits` in run order (`runEdits` in src/lib/run-view.ts). */
export default function PlannedEdits({ edits }: { edits: readonly PreviewEdit[] }) {
  const [filter, setFilter] = useState<PreviewKind | "all">("all");
  const [more, setMore] = useState(false);
  // The open cards, by edit number, so Expand all and Collapse all reach every one.
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const count = (kind: PreviewKind) => edits.filter((e) => e.kind === kind).length;
  // Singles only get a filter when there are any, which only runs made while tracks could have
  // them have.
  const filters = KINDS.filter((k) => k.kind !== "single" || count("single") > 0);
  // A filter left with nothing in it shows them all again.
  const active = filter !== "all" && count(filter) ? filter : "all";
  const list = active === "all" ? edits : edits.filter((e) => e.kind === active);
  const shown = more ? list : list.slice(0, FIRST);
  const anyOpen = list.some((e) => opened.has(e.n));
  const allOpen = list.every((e) => opened.has(e.n));
  // Opening every card also shows the ones past "Show N more".
  const expandAll = () => {
    setOpened(new Set(edits.map((e) => e.n)));
    setMore(true);
  };
  const setOpen = (n: number, open: boolean) =>
    setOpened((prev) => {
      if (prev.has(n) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(n);
      else next.delete(n);
      return next;
    });
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
              {k.kind === "album" && edits.some((e) => e.kind === "album" && e.noun === "single")
                ? "Single"
                : k.label}{" "}
              {count(k.kind)}
            </button>
          ))}
        </div>
      </div>
      <div className="planned-tools">
        <button type="button" className="link" disabled={allOpen} onClick={expandAll}>
          Expand all
        </button>
        <button
          type="button"
          className="link"
          disabled={!anyOpen}
          onClick={() => setOpened(new Set())}
        >
          Collapse all
        </button>
      </div>
      <ul className="planned-list">
        {shown.map((e) => (
          <EditCard key={e.n} edit={e} open={opened.has(e.n)} onToggle={(o) => setOpen(e.n, o)} />
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
  if (edit.creates) return `New ${edit.noun}`;
  return edit.kind === "album" ? "Adds statements" : `Reused ${name}`;
}

function EditCard({
  edit,
  open,
  onToggle,
}: {
  edit: PreviewEdit;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const n = edit.statements.length;
  return (
    <li>
      <details
        className="planned-card"
        open={open}
        onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
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
