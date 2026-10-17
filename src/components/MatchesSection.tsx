import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import {
  type Candidate,
  dismissAllIds,
  fillUnambiguous,
  groupId,
  isSimilarOnly,
  pickSingle,
  pickTrack,
  reviewSummary,
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
  single: { name: "Single", edge: "rg-edge", used: "Reused as single" },
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
  const hasRows = plan.tracks.some((tracks) => tracks.length > 0);

  // Once every track is reviewed the card folds into a summary, unless it was
  // opened, or the last one was reviewed here (so Undo stays at hand).
  const [kept, setKept] = useState(false);
  // The control that takes the place of the one just clicked, to keep focus on.
  const focusTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTo.current) return;
    document.querySelector<HTMLElement>(`#matches [data-focus="${focusTo.current}"]`)?.focus();
    focusTo.current = null;
  });
  const setDisc = (di: number, fn: (disc: Disc) => void) => {
    setKept(true);
    update((s) => fn(s.discs[di]));
  };
  const use = (r: TrackReview, c: Candidate) => {
    focusTo.current = `undo:${c.id}`;
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
    focusTo.current = `use:${c.id}`;
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
  const dismiss = (r: TrackReview, ids: string[]) => {
    focusTo.current = `restore:${r.di}:${r.n}`;
    setKept(true);
    setDismissed((prev) => new Set([...prev, ...ids]));
  };
  const restore = (r: TrackReview) => {
    setKept(true);
    setDismissed((prev) => new Set([...prev].filter((id) => !id.startsWith(`${r.di}:${r.n}:`))));
  };
  const fill = () => {
    setKept(true);
    update((s) => s.discs.forEach((d, di) => fillUnambiguous(d, di, left)));
  };
  const sum = reviewSummary(reviews);
  const allReviewed = sum.tracks > 0 && sum.reviewed === sum.tracks;
  const folded = allReviewed && !kept;

  if (!reviews.length)
    return (
      <section
        className={`block match-state${status === "failed" && hasRows ? " err" : ""}`}
        id="matches"
      >
        <h2>Possible matches</h2>
        <p className="match-empty" role="status">
          {!hasRows ? (
            "Tracks that may already be on Wikidata are listed here."
          ) : status === "off" ? (
            <>
              Give the performers QIDs to look for items already on Wikidata.{" "}
              <a href="#performers">Go to Performers</a>
            </>
          ) : status === "pending" ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Looking for items already on Wikidata…
            </>
          ) : status === "failed" ? (
            "Couldn't look for items already on Wikidata."
          ) : (
            "No items already on Wikidata match these tracks. Everything will be created new."
          )}
        </p>
      </section>
    );

  return (
    <section className={`block${folded ? " match-folded" : ""}`} id="matches">
      <div className="match-top">
        <h2>
          Possible matches{" "}
          {allReviewed ? (
            <span className="pill ok">
              {sum.reviewed} of {sum.tracks} reviewed
            </span>
          ) : (
            <span className="pill warn">
              {open} of {plural(reviews.length, "track")} to review
            </span>
          )}
        </h2>
        {folded && (
          <span className="match-sum">
            {[
              sum.reused > 0 && `${sum.reused} reused`,
              sum.dismissed > 0 && `${sum.dismissed} dismissed`,
            ]
              .filter(Boolean)
              .join(", ") || "Other QIDs are filled in"}
          </span>
        )}
        {status === "pending" && (
          <span className="match-checking" role="status">
            <span className="spinner" aria-hidden="true" />
            Checking for changes…
          </span>
        )}
        {!folded && fillable > 0 && (
          <button type="button" className="ghost" onClick={fill}>
            Fill in {plural(fillable, "unambiguous match", "unambiguous matches")}
          </button>
        )}
        {allReviewed && (
          <button
            type="button"
            className="link match-toggle"
            aria-expanded={!folded}
            aria-controls={folded ? undefined : "match-body"}
            onClick={() => setKept(folded)}
          >
            {folded ? "Show" : "Hide"}
          </button>
        )}
      </div>
      {!folded && (
        <div id="match-body">
          <p className="hint">
            Items already on Wikidata with a track's title, or one that differs only in punctuation,
            accents or “&” and “and”. Use one to reuse it, or dismiss it.
          </p>
          <div className="pills match-counts">
            <span className="pill">
              <strong>{strong}</strong> title + performer
            </span>
            <span className="pill">
              <strong>{visible.length - strong}</strong> title only
            </span>
          </div>
          <div className="match-groups">
            {reviews.map((r) => {
              const rest = dismissAllIds(r);
              return (
                <div
                  className={`match-group${r.reviewed ? " reviewed" : ""}`}
                  id={groupId(r.di, r.n)}
                  key={`${r.di}:${r.n}`}
                >
                  <div className="match-head">
                    <span className="muted">
                      Disc {r.di + 1} · {r.n}
                    </span>
                    <strong>{r.title}</strong>
                    {r.candidates.length > 1 && (
                      <span className="muted">· {plural(r.candidates.length, "candidate")}</span>
                    )}
                    {r.reviewed && <span className="pill ok">Reviewed</span>}
                    {r.dismissed > 0 && (
                      <button
                        type="button"
                        className="link"
                        data-focus={`restore:${r.di}:${r.n}`}
                        onClick={() => restore(r)}
                      >
                        {r.dismissed} dismissed · Restore
                      </button>
                    )}
                    {!r.reviewed && rest.length > 1 && (
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => dismiss(r, rest)}
                      >
                        Dismiss all
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
                          onDismiss={() => dismiss(r, [c.id])}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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
        <span className="sw" style={{ background: `var(--${kind.edge})` }} aria-hidden="true" />
        {kind.name}
      </span>
      <span className="match-text">
        <span className="match-label">
          <span className="mono">
            <WikiLink base={wikiBaseUrl} qid={m.qid} />
          </span>
          <b>{m.label ?? "(no label)"}</b>
        </span>
        {m.description && <span className="muted">{m.description}</span>}
      </span>
      <span className="pills">
        <span
          className={`pill${c.strong ? " strong" : ""}`}
          title={`Matched by ${m.reasons.join(", ")}`}
        >
          {isSimilarOnly(m)
            ? c.strong
              ? "Similar title + performer"
              : "Similar title only"
            : c.strong
              ? "Title + performer"
              : "Title only"}
        </span>
        {c.others.length > 0 && (
          <span className="pill bad edge">Description names {c.others.join(", ")}</span>
        )}
      </span>
      {c.used ? (
        <span className="match-actions done">
          {kind.used}
          <button type="button" className="ghost" data-focus={`undo:${c.id}`} onClick={onUndo}>
            Undo
          </button>
        </span>
      ) : c.taken ? (
        <span className="match-actions muted">Another QID is filled in</span>
      ) : (
        <span className="match-actions">
          <button type="button" data-focus={`use:${c.id}`} onClick={onUse}>
            {c.slot === "single"
              ? "Use as single"
              : c.slot === "track" && (m as TrackMatch).composition
                ? "Use with its composition"
                : "Use"}
          </button>
          <button type="button" className="ghost quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      )}
    </li>
  );
}

/** How many of a disc's tracks have possible matches to review, linked to the first one's group. */
export function UnreviewedNotice({ count, href = "#matches" }: { count: number; href?: string }) {
  return (
    <p className="match-notice">
      <span>{plural(count, "track")} may already be on Wikidata.</span>
      <a href={href}>Review possible matches ↓</a>
    </p>
  );
}
