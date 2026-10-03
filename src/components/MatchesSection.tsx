import { useRef } from "react";
import { useAuth } from "../lib/auth-context.ts";
import {
  type Candidate,
  fillUnambiguous,
  groupId,
  pickSingle,
  pickTrack,
  type Slot,
  type TrackReview,
  withoutDismissed,
} from "../lib/matches.ts";
import type { Disc, SingleState } from "../lib/plan.ts";
import type { TrackMatch } from "../lib/api-types.ts";
import { WikiLink } from "./common.tsx";
import type { Matches, MatchStatus } from "./use-matches.ts";
import type { SectionProps } from "./types.ts";

const KINDS: Record<Slot, { name: string; edge: string; used: string }> = {
  comp: { name: "Composition", edge: "cmp-edge", used: "Reused as composition" },
  track: { name: "Track", edge: "trk-edge", used: "Reused as track" },
  single: { name: "Single", edge: "rg-edge", used: "Linked as this track’s single" },
};

/** A row's fields as they were before a candidate was used, to undo it. */
interface Before {
  comp?: string;
  track?: string;
  single?: SingleState;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Items already on Wikidata with a track's title, grouped by disc and track,
 * each to use or dismiss.
 */
export default function MatchesSection({
  state,
  update,
  plan,
  matches,
  status,
  reviews,
  dismissed,
  setDismissed,
}: SectionProps & {
  matches: Matches;
  status: MatchStatus;
  reviews: TrackReview[];
  dismissed: ReadonlySet<string>;
  setDismissed: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void;
}) {
  // What each use replaced, by candidate, so Undo puts it back.
  const before = useRef(new Map<string, Before>());
  const visible = reviews.flatMap((r) => r.candidates);
  const strong = visible.filter((c) => c.strong).length;
  const open = reviews.filter((r) => !r.reviewed).length;
  const left = withoutDismissed(matches, dismissed);
  const fillable = state.discs.reduce(
    (sum, d, di) => sum + fillUnambiguous(structuredClone(d), di, left),
    0,
  );
  const hasRows = plan.parsed.some((rows) => rows.some((r) => r.error === undefined));

  const setDisc = (di: number, fn: (disc: Disc) => void) => update((s) => fn(s.discs[di]));
  const use = (r: TrackReview, c: Candidate) => {
    const d = state.discs[r.di];
    before.current.set(c.id, {
      comp: d.comp[r.n],
      track: d.track[r.n],
      single: d.single[r.n] && { ...d.single[r.n] },
    });
    setDisc(r.di, (disc) => {
      if (c.slot === "comp") disc.comp[r.n] = c.match.qid;
      else if (c.slot === "track") pickTrack(disc, r.n, c.match as TrackMatch);
      else pickSingle(disc, r.n, c.match.qid);
    });
  };
  const undo = (r: TrackReview, c: Candidate) => {
    const was = before.current.get(c.id);
    before.current.delete(c.id);
    setDisc(r.di, (disc) => {
      const put = (k: "comp" | "track", v: string | undefined) => {
        if (v === undefined) delete disc[k][r.n];
        else disc[k][r.n] = v;
      };
      if (!was) {
        // Used before this page loaded: clear the field it filled.
        if (c.slot !== "single") delete disc[c.slot][r.n];
        else if (disc.single[r.n]?.date) disc.single[r.n].qid = "";
        else delete disc.single[r.n];
        return;
      }
      if (c.slot !== "comp") {
        if (was.single) disc.single[r.n] = was.single;
        else delete disc.single[r.n];
      }
      if (c.slot !== "single") put("comp", was.comp);
      if (c.slot === "track") put("track", was.track);
    });
  };
  const dismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));
  const restore = (r: TrackReview) =>
    setDismissed((prev) => new Set([...prev].filter((id) => !id.startsWith(`${r.di}:${r.n}:`))));

  return (
    <section className="block" id="matches">
      <h2>Possible matches</h2>
      <p className="hint">
        Items already on Wikidata with a track's title. Use one to reuse it instead of creating a
        duplicate, or dismiss it.
      </p>
      {!reviews.length ? (
        <p className="msg muted">
          {!hasRows
            ? "Tracks that may already be on Wikidata are listed here."
            : status === "off"
              ? "Give the performers QIDs to look for items already on Wikidata."
              : status === "pending"
                ? "Looking for items already on Wikidata…"
                : status === "failed"
                  ? "Couldn't look for items already on Wikidata."
                  : "No items already on Wikidata match these tracks."}
        </p>
      ) : (
        <>
          <div className="row match-counts">
            <span className="chip">
              <strong>{strong}</strong> title + performer
            </span>
            <span className="chip">
              <strong>{visible.length - strong}</strong> title only
            </span>
            <span className="chip">
              <strong>{open}</strong> of {plural(reviews.length, "track")} to review
            </span>
            {status === "pending" && <span className="muted">Checking for changes…</span>}
            {fillable > 0 && (
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  update((s) => s.discs.forEach((d, di) => fillUnambiguous(d, di, left)))
                }
              >
                Fill in {plural(fillable, "unambiguous match", "unambiguous matches")}
              </button>
            )}
          </div>
          <div className="match-groups">
            {reviews.map((r) => (
              <div className="match-group" id={groupId(r.di, r.n)} key={`${r.di}:${r.n}`}>
                <div className="match-head">
                  <span className="muted">
                    Disc {r.di + 1} · {r.n}
                  </span>
                  <strong>{r.title}</strong>
                  {r.reviewed && <span className="chip ok">Reviewed</span>}
                  {r.dismissed > 0 && (
                    <button type="button" className="link" onClick={() => restore(r)}>
                      {r.dismissed} dismissed · Restore
                    </button>
                  )}
                </div>
                {r.candidates.length > 0 && (
                  <ul className="candidates">
                    {r.candidates.map((c) => (
                      <CandidateItem
                        key={c.id}
                        c={c}
                        onUse={() => use(r, c)}
                        onUndo={() => undo(r, c)}
                        onDismiss={() => dismiss(c.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CandidateItem({
  c,
  onUse,
  onUndo,
  onDismiss,
}: {
  c: Candidate;
  onUse: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const kind = KINDS[c.slot];
  const m = c.match;
  return (
    <li className={c.used ? "used" : undefined}>
      <span className="match-kind">
        <i style={{ background: `var(--${kind.edge})` }} />
        {kind.name}
      </span>
      <WikiLink base={wikiBaseUrl} qid={m.qid} />
      <span className="match-text">
        <b>{m.label ?? "(no label)"}</b>{" "}
        {m.description && <span className="muted">{m.description}</span>}
      </span>
      {c.others.length > 0 && (
        <span className="chip warn">Description names {c.others.join(", ")}</span>
      )}
      <span className="chip" title={`Matched by ${m.reasons.join(", ")}`}>
        {c.strong ? "Title + performer" : "Title only"}
      </span>
      {c.used ? (
        <span className="match-actions done">
          {kind.used}
          <button type="button" className="ghost small" onClick={onUndo}>
            Undo
          </button>
        </span>
      ) : c.taken ? (
        <span className="match-actions muted">Another QID is filled in</span>
      ) : (
        <span className="match-actions">
          <button type="button" className="ghost small" onClick={onUse}>
            {c.slot === "single"
              ? "Use as single"
              : c.slot === "track" && (m as TrackMatch).composition
                ? "Use with its composition"
                : "Use"}
          </button>
          <button type="button" className="ghost small quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      )}
    </li>
  );
}

/** How many tracks still have possible matches to review, linked to the card. */
export function UnreviewedNotice({ count }: { count: number }) {
  return (
    <p className="msg warn">
      <a href="#matches">{plural(count, "track")}</a> still {count === 1 ? "has" : "have"}{" "}
      unreviewed possible matches.
    </p>
  );
}
