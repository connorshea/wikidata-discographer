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
  comesWithTrack,
  reviewedLine,
  reviewSummary,
  type Slot,
  summaryLine,
  type TrackReview,
  withoutDismissed,
} from "../lib/matches.ts";
import type { Disc, SingleState } from "../lib/plan.ts";
import type { TrackMatch } from "../lib/api-types.ts";
import { WikiLink } from "./common.tsx";
import type { Matches, MatchStatus } from "./use-matches.ts";
import type { SectionProps } from "./types.ts";

const KINDS: Record<Slot, string> = { comp: "Composition", track: "Track", single: "Single" };

/** A row's fields as they were before a candidate was used, to undo it. */
interface Before {
  comp?: string;
  track?: string;
  single?: SingleState;
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
  // The track last acted on keeps its place once it's reviewed, so Undo stays
  // at hand, unless every candidate in it was dismissed and there's nothing
  // left to undo. Other reviewed tracks fold into a line under Reviewed, and
  // Change opens one there again.
  const [held, setHeld] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // The control that takes the place of the one just clicked, to keep focus on.
  // Failing that, the first control in the track it belongs to, since the
  // track may have moved between the open ones and Reviewed.
  const focusTo = useRef<{ to: string; track: TrackReview } | null>(null);
  useEffect(() => {
    if (!focusTo.current) return;
    const { to, track } = focusTo.current;
    (
      document.querySelector<HTMLElement>(`#matches [data-focus="${to}"]`) ??
      document.querySelector<HTMLElement>(`#${groupId(track.di, track.n)} button`)
    )?.focus();
    focusTo.current = null;
  });
  const touch = (r: TrackReview) => {
    setKept(true);
    if (!opened.has(keyOf(r))) setHeld(keyOf(r));
  };
  const setDisc = (r: TrackReview, fn: (disc: Disc) => void) => {
    touch(r);
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
    focusTo.current = { to: `undo:${c.id}`, track: r };
    const d = state.discs[r.di];
    before.current.set(c.id, {
      comp: d.comp[r.n],
      track: d.track[r.n],
      single: d.single[r.n] && { ...d.single[r.n] },
    });
    setDisc(r, (disc) => {
      if (c.slot === "comp") disc.comp[r.n] = c.match.qid;
      else if (c.slot === "track") pickTrack(disc, r.n, c.match as TrackMatch);
      else pickSingle(disc, r.n, c.match.qid);
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
    focusTo.current = { to: `restore:${r.di}:${r.n}`, track: r };
    touch(r);
    setDismissed((prev) => new Set([...prev, ...ids]));
  };
  const restore = (r: TrackReview) => {
    touch(r);
    setDismissed((prev) => new Set([...prev].filter((id) => !id.startsWith(`${r.di}:${r.n}:`))));
  };
  const fill = () => {
    setKept(true);
    update((s) => s.discs.forEach((d, di) => fillUnambiguous(d, di, left)));
  };
  const label = (r: TrackReview) =>
    state.discs.length > 1 ? `Disc ${r.di + 1} · ${r.n}` : `${r.n}`;
  const sum = reviewSummary(reviews);
  const allReviewed = sum.tracks > 0 && sum.reviewed === sum.tracks;
  const folded = allReviewed && !kept;
  const below = (r: TrackReview) =>
    opened.has(keyOf(r)) || (r.reviewed && (keyOf(r) !== held || !r.candidates.length));
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
                <a href="#performers">Go to Performers</a>
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
          {!r.reviewed && rest.length > 1 && (
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
            {r.candidates.map((c) => (
              <CandidateItem
                key={c.id}
                c={c}
                title={r.title}
                // Used on its own here, it's undone on its own too.
                withTrack={comesWithTrack(r, c) && !before.current.has(c.id)}
                onUse={() => use(r, c)}
                onUndo={() => undo(r, c)}
                onDismiss={() => dismiss(r, [c.id])}
              />
            ))}
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
  title,
  withTrack,
  onUse,
  onUndo,
  onDismiss,
}: {
  c: Candidate;
  /** The track's title, to say when the item's label differs. */
  title: string;
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
          <span>{m.description ?? m.label ?? "No label or description"}</span>
          {tag && (
            <span className="match-tag" title={`Matched by ${m.reasons.join(", ")}`}>
              {tag}
            </span>
          )}
        </span>
        {m.label && m.description && m.label.toLocaleLowerCase() !== title.toLocaleLowerCase() && (
          <span className="match-note">Titled “{m.label}”</span>
        )}
        {composition && !c.used && (
          <span className="match-note">Using it also uses its composition, {composition}</span>
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

/** How many of a disc's tracks have possible matches to review, linked to the first one's group. */
export function UnreviewedNotice({ count, href = "#matches" }: { count: number; href?: string }) {
  return (
    <p className="match-notice">
      <span>{plural(count, "track")} may already be on Wikidata.</span>
      <a href={href}>Review possible matches ↓</a>
    </p>
  );
}
