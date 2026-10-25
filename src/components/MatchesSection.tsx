import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context.ts";
import {
  type Candidate,
  dismissAllIds,
  groupId,
  isSimilarOnly,
  moveRowId,
  moveRowIds,
  pickTrack,
  comesWithTrack,
  reviewedLine,
  reviewSummary,
  type RowMove,
  type Slot,
  summaryLine,
  takenLine,
  ties,
  type TrackReview,
} from "../lib/matches.ts";
import type { Disc } from "../lib/plan.ts";
import type { TrackMatch } from "../lib/api-types.ts";
import { WikiLink } from "./common.tsx";
import type { MatchStatus } from "./use-matches.ts";
import type { SectionProps } from "./types.ts";

const KINDS: Record<Slot, string> = { comp: "Composition", track: "Track" };

/** A row's fields as they were before a candidate was used, to undo it. */
interface Before {
  comp?: string;
  track?: string;
}

export interface MatchesHandle {
  /** Rows moved (renumbered, or their disc removed), so what's kept by row follows them. */
  moveRows: (move: RowMove) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const keyOf = (r: TrackReview) => `${r.di}:${r.n}`;

/**
 * Items already on Wikidata with a track's title, grouped by disc and track,
 * each to use or dismiss.
 */
export default function MatchesSection({
  state,
  update,
  plan,
  status,
  reviews,
  setDismissed,
  ref,
}: SectionProps & {
  status: MatchStatus;
  reviews: TrackReview[];
  setDismissed: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void;
  ref?: Ref<MatchesHandle>;
}) {
  // What each use replaced, by candidate, so Undo puts it back.
  const before = useRef(new Map<string, Before>());
  const open = reviews.filter((r) => !r.reviewed).length;
  const hasRows = plan.tracks.some((tracks) => tracks.length > 0);

  // Once every track is reviewed the card folds into a summary, unless it was
  // opened, or the last one was reviewed here.
  const [kept, setKept] = useState(false);
  // Reviewed tracks fold into a line under Reviewed, and Change opens one there again.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // Groups showing the candidates another QID keeps out, which are hidden at first.
  const [showTaken, setShowTaken] = useState<ReadonlySet<string>>(new Set());
  useImperativeHandle(ref, () => ({
    moveRows: (move) => {
      const moved = new Map<string, Before>();
      for (const [id, was] of before.current) {
        const to = moveRowId(id, move);
        if (to !== null) moved.set(to, was);
      }
      before.current = moved;
      setOpened((prev) => moveRowIds(prev, move));
      setShowTaken((prev) => moveRowIds(prev, move));
    },
  }));
  // The control that takes the place of the one just clicked, to keep focus on.
  // Failing that, the track moved under Reviewed: the next track still to
  // review slides into its place, so focus goes there rather than following it
  // down the page. Last of all, the first control in the track itself.
  const focusTo = useRef<{ to: string; track: TrackReview; next?: TrackReview } | null>(null);
  useEffect(() => {
    if (!focusTo.current) return;
    const { to, track, next } = focusTo.current;
    const first = (r: TrackReview) =>
      document.querySelector<HTMLElement>(`#${groupId(r.di, r.n)} button`);
    (
      document.querySelector<HTMLElement>(`#matches [data-focus="${to}"]`) ??
      (next && first(next)) ??
      first(track)
    )?.focus();
    focusTo.current = null;
  });
  // Where focus goes after an action on `r`, in case it moves under Reviewed.
  const focusAfter = (to: string, r: TrackReview) => {
    const i = queue.findIndex((q) => keyOf(q) === keyOf(r));
    focusTo.current = { to, track: r, next: i < 0 ? undefined : (queue[i + 1] ?? queue[i - 1]) };
  };
  const setDisc = (r: TrackReview, fn: (disc: Disc) => void) => {
    setKept(true);
    update((s) => fn(s.discs[r.di]));
  };
  const toggle = (r: TrackReview, open: boolean) => {
    focusTo.current = { to: `${open ? "hide" : "change"}:${keyOf(r)}`, track: r };
    setOpened((prev) => {
      const next = new Set(prev);
      if (open) next.add(keyOf(r));
      else next.delete(keyOf(r));
      return next;
    });
  };
  const use = (r: TrackReview, c: Candidate) => {
    focusAfter(`undo:${c.id}`, r);
    const d = state.discs[r.di];
    before.current.set(c.id, {
      comp: d.comp[r.n],
      track: d.track[r.n],
    });
    setDisc(r, (disc) => {
      if (c.slot === "comp") disc.comp[r.n] = c.match.qid;
      else pickTrack(disc, r.n, c.match as TrackMatch);
    });
  };
  const undo = (r: TrackReview, c: Candidate) => {
    focusTo.current = { to: `use:${c.id}`, track: r };
    const was = before.current.get(c.id);
    before.current.delete(c.id);
    setDisc(r, (disc) => {
      const put = (k: "comp" | "track", v: string | undefined) => {
        if (v === undefined) delete disc[k][r.n];
        else disc[k][r.n] = v;
      };
      if (!was) {
        // Used before this page loaded: clear the field it filled.
        delete disc[c.slot][r.n];
        return;
      }
      put("comp", was.comp);
      if (c.slot === "track") put("track", was.track);
    });
  };
  const dismiss = (r: TrackReview, ids: string[]) => {
    focusAfter(`restore:${r.di}:${r.n}`, r);
    setKept(true);
    setDismissed((prev) => new Set([...prev, ...ids]));
  };
  const restore = (r: TrackReview) => {
    setKept(true);
    setDismissed((prev) => new Set([...prev].filter((id) => !id.startsWith(`${r.di}:${r.n}:`))));
  };
  const label = (r: TrackReview) =>
    state.discs.length > 1 ? `Disc ${r.di + 1} · ${r.n}` : `${r.n}`;
  const sum = reviewSummary(reviews);
  const allReviewed = sum.tracks > 0 && sum.reviewed === sum.tracks;
  const folded = allReviewed && !kept;
  const below = (r: TrackReview) => opened.has(keyOf(r)) || r.reviewed;
  const queue = reviews.filter((r) => !below(r));
  const done = reviews.filter(below);

  if (!reviews.length)
    return (
      <section
        className={`block match-state${status === "failed" && hasRows ? " err" : ""}`}
        id="matches"
      >
        <h2>Possible matches</h2>
        <p className="match-empty" role="status">
          {!hasRows ? (
            <>
              <StateIcon kind="idle" />
              Tracks that may already be on Wikidata are listed here.
            </>
          ) : status === "off" ? (
            <>
              <StateIcon kind="off" />
              <span>
                Give the performers QIDs to look for items already on Wikidata.{" "}
                <a href="#performers">Go to People</a>
              </span>
            </>
          ) : status === "pending" ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Looking for items already on Wikidata…
            </>
          ) : status === "failed" ? (
            <>
              <StateIcon kind="failed" />
              Couldn't look for items already on Wikidata.
            </>
          ) : (
            <>
              <StateIcon kind="none" />
              No items already on Wikidata match these tracks. Everything will be created new.
            </>
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
            <span className="pill">
              {sum.reviewed} of {sum.tracks} reviewed
            </span>
          ) : (
            <span className="pill warn">
              {open} of {plural(reviews.length, "track")} to review
            </span>
          )}
        </h2>
        {folded && <span className="match-sum">{summaryLine(sum)}</span>}
        {status === "pending" && (
          <span className="match-checking" role="status">
            <span className="spinner" aria-hidden="true" />
            Checking for changes…
          </span>
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
            Items already on Wikidata that the system has auto-matched. You can reuse it, or dismiss
            it. This helps prevent the creation of duplicates.
          </p>
          {queue.length > 0 && <div className="match-groups">{queue.map((r) => group(r))}</div>}
          {done.length > 0 && (
            <div className="match-done">
              <h3 className="kicker">Reviewed · {done.length}</h3>
              <ul className="match-done-list">
                {done.map((r) =>
                  opened.has(keyOf(r)) ? (
                    <li key={keyOf(r)}>{group(r)}</li>
                  ) : (
                    <li className="match-line" id={groupId(r.di, r.n)} key={keyOf(r)}>
                      <span className="muted">{label(r)}</span>
                      <strong>{r.title}</strong>
                      <span className="muted">{reviewedLine(r)}</span>
                      <button
                        type="button"
                        className="link"
                        data-focus={`change:${keyOf(r)}`}
                        aria-label={`Change ${r.title}`}
                        onClick={() => toggle(r, true)}
                      >
                        Change
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );

  function group(r: TrackReview) {
    const rest = dismissAllIds(r);
    const taken = takenLine(r);
    const showingTaken = showTaken.has(keyOf(r));
    const shown = showingTaken ? r.candidates : r.candidates.filter((c) => !c.taken);
    return (
      <div className="match-group" id={groupId(r.di, r.n)} key={`${r.di}:${r.n}`}>
        <div className="match-head">
          <span className="muted">{label(r)}</span>
          <strong>{r.title}</strong>
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
          {!r.reviewed && shown.filter((c) => !c.used).length > 1 && (
            <button type="button" className="link" onClick={() => dismiss(r, rest)}>
              Dismiss all
            </button>
          )}
          {opened.has(keyOf(r)) && (
            <button
              type="button"
              className="link"
              data-focus={`hide:${keyOf(r)}`}
              onClick={() => toggle(r, false)}
            >
              Hide
            </button>
          )}
        </div>
        {r.candidates.length > 0 && (
          <ul className="candidates">
            {shown.map((c) => (
              <CandidateItem
                key={c.id}
                c={c}
                // Used on its own here, it's undone on its own too.
                withTrack={comesWithTrack(r, c) && !before.current.has(c.id)}
                onUse={() => use(r, c)}
                onUndo={() => undo(r, c)}
                onDismiss={() => dismiss(r, [c.id])}
              />
            ))}
            {taken && (
              <li className="match-taken">
                <span className="muted">{taken} · Another QID is filled in</span>
                <button
                  type="button"
                  className="link"
                  aria-expanded={showingTaken}
                  onClick={() =>
                    setShowTaken((prev) => {
                      const next = new Set(prev);
                      if (showingTaken) next.delete(keyOf(r));
                      else next.add(keyOf(r));
                      return next;
                    })
                  }
                >
                  {showingTaken ? "Hide" : "Show"}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
}

/** The icon by an empty card's line: nothing to look at yet, needs performers, failed, or no matches. */
function StateIcon({ kind }: { kind: "idle" | "off" | "failed" | "none" }) {
  return (
    <svg
      className={`state-icon ${kind}`}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      {kind === "none" ? (
        <>
          <circle cx="10" cy="10" r="9" />
          <path d="M6 10.3l2.6 2.6L14 7.4" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="8.5" />
          {kind === "idle" && <circle className="dot" cx="10" cy="10" r="2.5" />}
          {kind === "off" && <path d="M10 5.5v5.5M10 13.8v.2" />}
          {kind === "failed" && <path d="M7 7l6 6M13 7l-6 6" />}
        </>
      )}
    </svg>
  );
}

const Warn = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5l7 12.5H1z" />
    <path d="M8 6.2v3.6M8 11.8v.2" />
  </svg>
);

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.4l3 3 6-6.4" />
  </svg>
);

function CandidateItem({
  c,
  withTrack,
  onUse,
  onUndo,
  onDismiss,
}: {
  c: Candidate;
  /** It was filled in by using the track, so it's undone with that. */
  withTrack: boolean;
  onUse: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const m = c.match;
  const composition = c.slot === "track" ? (m as TrackMatch).composition : null;
  const tag = isSimilarOnly(m)
    ? c.strong
      ? "Similar title"
      : "Similar title only"
    : c.strong
      ? null
      : "Title only";
  return (
    <li className={c.used ? "used" : undefined}>
      <span className="match-kind">{KINDS[c.slot]}</span>
      <span className="match-text">
        <span className="match-label">
          <span className="mono">
            <WikiLink base={wikiBaseUrl} qid={m.qid} />
          </span>
          <span>
            {m.label ?? "No label"}
            {m.description && <span className="match-desc"> · {m.description}</span>}
          </span>
          {ties(m).map((t) => (
            <span key={t} className="match-tag tie">
              {t}
            </span>
          ))}
          {tag && (
            <span className="match-tag" title={`Matched by ${m.reasons.join(", ")}`}>
              {tag}
            </span>
          )}
        </span>
        {composition && !c.used && (
          <span className="match-note">Using it also uses its composition, {composition}</span>
        )}
        {c.slot === "track" && (m as TrackMatch).recordingUnknown && (
          <span className="match-warn">
            <Warn />
            No recording type set, so it may be a studio recording
          </span>
        )}
        {c.others.length > 0 && (
          <span className="match-warn">
            <Warn />
            Description names {c.others.join(", ")}
          </span>
        )}
      </span>
      {withTrack ? (
        <span className="match-actions muted">Comes with the track</span>
      ) : c.used ? (
        <span className="match-actions">
          <span className="match-using">
            <Check />
            Using
          </span>
          <button type="button" className="quiet" data-focus={`undo:${c.id}`} onClick={onUndo}>
            Undo
          </button>
        </span>
      ) : c.taken ? (
        <span className="match-actions muted">Another QID is filled in</span>
      ) : (
        <span className="match-actions">
          <button type="button" className="use" data-focus={`use:${c.id}`} onClick={onUse}>
            Use
          </button>
          <button type="button" className="quiet" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * How many of a disc's tracks have possible matches to review, linked to the
 * first one's group. `up` when the matches are above it on the page.
 */
export function UnreviewedNotice({
  count,
  href = "#matches",
  up = false,
}: {
  count: number;
  href?: string;
  up?: boolean;
}) {
  return (
    <p className="match-notice">
      <span>{plural(count, "track")} may already be on Wikidata.</span>
      <a href={href}>Review possible matches {up ? "↑" : "↓"}</a>
    </p>
  );
}
