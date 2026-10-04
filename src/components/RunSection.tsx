import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import type { Plan, State } from "../lib/plan.ts";
import { previewPlan } from "../lib/preview.ts";
import type {
  EditLogEntry,
  SubmissionInfo,
  SubmissionListResponse,
  SubmissionRequest,
  UnknownRunConflict,
} from "../lib/api-types.ts";
import { WikiLink } from "./common.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import PlanPreview from "./PlanPreview.tsx";
import type { SectionProps, Update } from "./types.ts";
import type { AlbumTracklist } from "./use-album-tracklist.ts";

const POLL_MS = 2000;

type UnknownRun = UnknownRunConflict["unknownRun"];

/**
 * Write the QIDs a run created back into the form, so a rerun reuses them
 * instead of duplicating. With `title` (the run's album title or QID), only
 * while the form still holds that album.
 */
function applyCreated(
  edits: Pick<EditLogEntry, "op" | "ok" | "key" | "qid">[],
  update: Update,
  title?: string,
) {
  const created = edits.filter((e) => e.op === "create" && e.ok && e.key && e.qid);
  if (!created.length) return;
  update((s: State) => {
    const album = s.album.mode === "create" ? s.album.title.trim() : s.album.qid.trim();
    if (title !== undefined && album !== title) return;
    for (const { key, qid } of created) {
      const [kind, di, n] = key!.split(":");
      const disc = s.discs[Number(di)];
      if (kind === "album") {
        s.album.mode = "existing";
        s.album.qid = qid!;
      } else if (!disc) continue;
      else if (kind === "comp") disc.comp[n] = qid!;
      else if (kind === "track") disc.track[n] = qid!;
      else if (kind === "single") disc.single[n] = { date: "", qid: qid! };
    }
  });
}

// The run started from this form, kept until it ends and its QIDs are written
// back, so leaving the page or reloading during a run doesn't lose them.
const OWN_RUN_KEY = "discographer:ownRun";

function loadOwnRun(): number | null {
  try {
    const id = Number(localStorage.getItem(OWN_RUN_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function saveOwnRun(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(OWN_RUN_KEY);
    else localStorage.setItem(OWN_RUN_KEY, String(id));
  } catch {
    // storage blocked: the run is only followed while the form stays open
  }
}

/** Poll a run until it ends, calling `onRun` with each answer. Returns a cleanup. */
function watchRun(
  id: number,
  onRun: (r: SubmissionInfo) => void,
  onError: (e: unknown) => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = () =>
    api<SubmissionInfo>(`/api/submissions/${id}`)
      .then((r) => {
        if (cancelled) return;
        onRun(r);
        if (r.status === "running") timer = setTimeout(poll, POLL_MS);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        onError(e);
        // A missing run (or someone else's) won't turn up by asking again.
        if (!(e instanceof FetchError && e.status === 404)) timer = setTimeout(poll, POLL_MS * 3);
      });
  void poll();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export default function RunSection({
  update,
  plan,
  state,
  albumTracklist,
  unreviewed,
  matchesPending,
}: SectionProps & {
  albumTracklist: AlbumTracklist | null;
  /** Tracks with possible matches not yet used or dismissed. They block the run. */
  unreviewed: number;
  /** The lookup for possible matches is in flight, so there may be more to review. */
  matchesPending: boolean;
}) {
  const { user } = useAuth();
  // The album list's "Open run" links here with ?run=<id>.
  const search = useSearch();
  const [, navigate] = useLocation();
  // Only a run started from this form writes its QIDs back into it.
  const [ownRun, setOwnRun] = useState(loadOwnRun);
  const ownRunRef = useRef(ownRun);
  const [runId, setRunId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(search).get("run"));
    return Number.isInteger(id) && id > 0 ? id : ownRun;
  });
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!new URLSearchParams(search).has("run")) return;
    navigate("/", { replace: true });
    sectionRef.current?.scrollIntoView();
  }, [search, navigate]);
  const [run, setRun] = useState<SubmissionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // The last run ended "unknown": what the server wants done before another.
  const [unknownRun, setUnknownRun] = useState<UnknownRun | null>(null);

  const followOwnRun = useCallback((id: number | null) => {
    ownRunRef.current = id;
    setOwnRun(id);
    saveOwnRun(id);
  }, []);
  // Write back the own run's QIDs once it ends, and stop following it.
  const settle = useCallback(
    (r: SubmissionInfo) => {
      if (r.status === "running" || r.id !== ownRunRef.current) return;
      followOwnRun(null);
      applyCreated(r.edits, update, r.title);
    },
    [followOwnRun, update],
  );
  const dropIfGone = useCallback(
    (id: number, e: unknown) => {
      if (e instanceof FetchError && e.status === 404 && ownRunRef.current === id)
        followOwnRun(null);
    },
    [followOwnRun],
  );

  // Runs are only readable logged in.
  const loggedIn = !!user;

  // The run on show.
  useEffect(() => {
    if (runId === null || !loggedIn) return;
    return watchRun(
      runId,
      (r) => {
        setRun(r);
        settle(r);
      },
      (e) => {
        setError(e instanceof Error ? e.message : "Couldn't load the run.");
        dropIfGone(runId, e);
      },
    );
  }, [runId, loggedIn, settle, dropIfGone]);

  // The own run, while another is on show.
  useEffect(() => {
    if (ownRun === null || ownRun === runId || !loggedIn) return;
    return watchRun(ownRun, settle, (e) => dropIfGone(ownRun, e));
  }, [ownRun, runId, loggedIn, settle, dropIfGone]);

  const running = run?.status === "running";
  const start = (confirmUnknown?: number) => {
    setStarting(true);
    setError(null);
    setUnknownRun(null);
    const body: SubmissionRequest = { state, confirmUnknown };
    api<{ id: number }>("/api/submissions", { method: "POST", body })
      .then(({ id }) => {
        followOwnRun(id);
        setRun(null);
        setRunId(id);
      })
      .catch((e: unknown) => {
        const conflict = e instanceof FetchError ? (e.body as Partial<UnknownRunConflict>) : null;
        if (conflict?.unknownRun) setUnknownRun(conflict.unknownRun);
        else setError(e instanceof FetchError ? e.message : "Couldn't start the run.");
      })
      .finally(() => setStarting(false));
  };

  const edits = plan.ops.length;
  return (
    <section className="block" ref={sectionRef}>
      <h2>Create on Wikidata</h2>
      {plan.messages.map(([kind, text], i) => (
        // The summary is neutral: green stands for compositions elsewhere.
        <p key={i} className={`msg ${kind === "ok" ? "summary" : kind}`}>
          {text}
        </p>
      ))}
      {unreviewed > 0 && <UnreviewedNotice count={unreviewed} />}
      {plan.ops.length > 0 && <PlanPreview plan={plan} state={state} />}
      <div className="row">
        <ConfirmRun
          label={
            starting
              ? "Checking the QIDs…"
              : running
                ? "Running…"
                : `Make ${edits} edit${edits === 1 ? "" : "s"}`
          }
          disabled={
            !user ||
            user.blocked ||
            !plan.ready ||
            !!albumTracklist ||
            unreviewed > 0 ||
            matchesPending ||
            running ||
            starting
          }
          plan={plan}
          state={state}
          username={user?.username ?? "you"}
          onConfirm={() => start()}
        />
        {!user && <span className="hint">Log in to edit.</span>}
        {user && albumTracklist && (
          <span className="hint">The album already has a tracklist. See the Album section.</span>
        )}
        {user && !albumTracklist && unreviewed > 0 && (
          <span className="hint">Use or dismiss each possible match first.</span>
        )}
        {user && !albumTracklist && !unreviewed && matchesPending && (
          <span className="hint">Looking for possible matches…</span>
        )}
      </div>
      <p className="hint">
        Edits are made with your account and grouped in EditGroups, so the whole run can be reviewed
        or undone together. They go out a second or two apart, so a long album takes a minute or
        two. Statements an item already has are skipped, so a failed run can be started again.
      </p>
      {error && <p className="msg err">{error}</p>}
      {unknownRun && (
        <UnknownRunGuard
          run={unknownRun}
          disabled={starting}
          onUse={() => {
            applyCreated(
              [{ op: "create", ok: true, key: unknownRun.key, qid: unknownRun.qid }],
              update,
            );
            setUnknownRun(null);
          }}
          onConfirm={() => start(unknownRun.id)}
        />
      )}
      {run && <RunProgress run={run} />}
      {user && <RecentRuns current={runId} onOpen={setRunId} refresh={run?.status} />}
    </section>
  );
}

/** The run button. Edits go live on Wikidata, so it asks first in a modal dialog. */
function ConfirmRun({
  label,
  disabled,
  plan,
  state,
  username,
  onConfirm,
}: {
  label: string;
  disabled: boolean;
  plan: Plan;
  state: State;
  username: string;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  const n = plan.ops.length;
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
          // Enter on the default focus shouldn't start the run.
          cancel.current?.focus();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClose={() => {
          setOpen(false);
          button.current?.focus();
        }}
        // A click on the backdrop lands on the <dialog> itself; its contents are
        // wrapped in a div that fills it, so clicks inside never do.
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="confirm-body">
          <h2 id={titleId}>{`Make ${n} edit${n === 1 ? "" : "s"} on Wikidata?`}</h2>
          <p id={bodyId}>
            The edits are made right away with your account, {username}. They can be undone together
            from EditGroups afterwards.
          </p>
          {open && <EditCounts plan={plan} state={state} />}
          <div className="row">
            <button ref={cancel} type="button" className="ghost" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                close();
                onConfirm();
              }}
            >
              {`Make ${n} edit${n === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** How many edits each part of the plan takes, e.g. "Tracks: 12 edits". */
function EditCounts({ plan, state }: { plan: Plan; state: State }) {
  const groups = useMemo(() => previewPlan(plan, state), [plan, state]);
  return (
    <ul className="confirm-counts">
      {groups.map((g) => (
        <li key={g.id}>
          {g.title}: {g.edits.length} edit{g.edits.length === 1 ? "" : "s"}
        </li>
      ))}
    </ul>
  );
}

/** The user's new items on the wiki, newest first. */
function contributionsUrl(base: string, username: string): string {
  return `${base}/wiki/Special:Contributions/${encodeURIComponent(username.replaceAll(" ", "_"))}?namespace=0&newOnly=1`;
}

function CheckLinks({ editGroupUrl }: { editGroupUrl: string }) {
  const { wikiBaseUrl, user } = useAuth();
  return (
    <>
      {user && (
        <>
          <a href={contributionsUrl(wikiBaseUrl, user.username)} target="_blank" rel="noreferrer">
            your contributions
          </a>
          {" · "}
        </>
      )}
      <a href={editGroupUrl} target="_blank" rel="noreferrer">
        the EditGroup
      </a>
    </>
  );
}

/** Shown when starting a run is held up by the last run's unconfirmed create. */
function UnknownRunGuard({
  run,
  disabled,
  onUse,
  onConfirm,
}: {
  run: UnknownRun;
  disabled: boolean;
  onUse: () => void;
  onConfirm: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  if (run.qid)
    return (
      <div className="msg warn">
        <p>
          Your last run created {run.what} after all, as{" "}
          <WikiLink base={wikiBaseUrl} qid={run.qid} />. Use it in the form so it isn't created
          twice, then start the run again.
        </p>
        <div className="row">
          {run.key && (
            <button type="button" onClick={onUse}>
              Use {run.qid} in the form
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="msg warn">
      <p>
        Wikidata didn't answer when your last run created {run.what}, and it still can't be found,
        but it may have been created anyway. Check <CheckLinks editGroupUrl={run.editGroupUrl} />{" "}
        before running again. If it was created, put its QID in the form.
      </p>
      <div className="row">
        <button type="button" className="ghost" disabled={disabled} onClick={onConfirm}>
          I checked and it wasn't created. Run anyway
        </button>
      </div>
    </div>
  );
}

function RunProgress({ run }: { run: SubmissionInfo }) {
  const { wikiBaseUrl } = useAuth();
  const done = run.edits.length;
  return (
    <div>
      <h3 className="sub">
        {run.title} —{" "}
        {run.status === "running"
          ? `${done} of ${run.total}`
          : run.status === "done"
            ? "done"
            : run.status === "failed"
              ? "stopped on an error"
              : run.status === "unknown"
                ? "stopped, outcome unknown"
                : "interrupted"}
      </h3>
      {run.status === "running" && <progress max={run.total} value={done} />}
      {run.status === "running" && (
        <p className="hint">
          {run.waitingUntil
            ? "Waiting a moment before the next edit, so they go out at a steady pace."
            : "Making the next edit…"}
        </p>
      )}
      {run.error && (
        <p className={`msg ${run.status === "unknown" ? "warn" : "err"}`}>{run.error}</p>
      )}
      {run.status === "interrupted" && (
        <p className="msg warn">The server restarted during this run. Start it again to finish.</p>
      )}
      <p className="hint">
        <a href={run.editGroupUrl} target="_blank" rel="noreferrer">
          View this run in EditGroups
        </a>
        {run.albumQid && (
          <>
            {" · album "}
            <WikiLink base={wikiBaseUrl} qid={run.albumQid} />
          </>
        )}
      </p>
      <ol className="log">
        {run.edits.map((e, i) => (
          <li key={i} className={e.ok ? undefined : "fail"}>
            {/* Matches the preview's headings; a statements edit's `what` says what it adds. */}
            {e.unknown ? "Outcome unknown: created? " : e.op === "create" ? "Created " : ""}
            {e.what}
            {e.qid && (
              <>
                {" "}
                {e.unknown && "found later as "}
                <WikiLink base={wikiBaseUrl} qid={e.qid} />
              </>
            )}
            {e.skipped > 0 && <span className="muted"> ({e.skipped} already there)</span>}
            {e.revid === null && e.ok && e.op === "addClaims" && (
              <span className="muted"> (nothing to add)</span>
            )}
            {e.error && <>: {e.error}</>}
            {e.unknown && !e.qid && (
              <>
                {" "}
                Check <CheckLinks editGroupUrl={run.editGroupUrl} />.
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RecentRuns({
  current,
  onOpen,
  refresh,
}: {
  current: number | null;
  onOpen: (id: number) => void;
  refresh: string | undefined;
}) {
  const [runs, setRuns] = useState<SubmissionListResponse["submissions"]>([]);
  useEffect(() => {
    let cancelled = false;
    api<SubmissionListResponse>("/api/submissions")
      .then((r) => !cancelled && setRuns(r.submissions))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current, refresh]);
  if (!runs.length) return null;
  return (
    <details>
      <summary>Your recent runs</summary>
      <ul className="matches">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="ghost small"
              disabled={r.id === current}
              onClick={() => onOpen(r.id)}
            >
              Show
            </button>
            <span>{r.title}</span>
            <span className="muted">
              {r.createdAt} · {r.status}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
