import {
  type MouseEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { api, FetchError } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import {
  adoptOwnRun,
  afterOwnRun,
  applyCreated,
  isGone,
  loadOwnRun,
  OWN_RUN_KEY,
  type OwnRun,
  saveOwnRun,
  settleOwnRun,
} from "../lib/own-run.ts";
import { musicBrainzUrl } from "../lib/music.ts";
import { EP_CLASS, type Plan, releaseNoun, type State } from "../lib/plan.ts";
import { previewPlan } from "../lib/preview.ts";
import type { PreviewEdit } from "../lib/preview.ts";
import type { RunningInfo } from "../lib/progress.ts";
import {
  editShares,
  type EditShare,
  entryKind,
  KIND_EDGES,
  plannedEdits,
  roughly,
  runEdits,
  runProgress,
  runSeconds,
  startedAt,
  timeLeft,
} from "../lib/run-view.ts";
import type {
  EditLogEntry,
  RecreateConflict,
  SubmissionInfo,
  SubmissionListResponse,
  SubmissionRequest,
  SubmissionStatus,
  TakenId,
  TakenIdsConflict,
  UnknownRunConflict,
} from "../lib/api-types.ts";
import { Qids, WikiLink } from "./common.tsx";
import { UnreviewedNotice } from "./MatchesSection.tsx";
import PlannedEdits from "./PlannedEdits.tsx";
import type { SectionProps } from "./types.ts";
import { useItemSummaries } from "./use-item-summaries.ts";
import { useStorageEvent } from "./use-storage-event.ts";

const POLL_MS = 2000;

/** Recent runs listed in the plan panel. */
const RECENT = 5;

type UnknownRun = UnknownRunConflict["unknownRun"];
type Recreate = RecreateConflict["recreate"];
type TakenIds = TakenIdsConflict["takenIds"];

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
        // A 401 means the session ended (logged out elsewhere, or the account
        // was blocked mid-run): asking again won't bring it back.
        const loggedOut = e instanceof FetchError && e.status === 401;
        if (!isGone(e) && !loggedOut) timer = setTimeout(poll, POLL_MS * 3);
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
  checklistDone,
  unreviewed,
  formId,
  stale,
  onFinished,
  slot,
  sideSlot,
  albumName,
  onRunning,
  onStarting,
  onShowing,
}: SectionProps & {
  /** Everything in the run's checklist (`runChecks`) is done. */
  checklistDone: boolean;
  /** Tracks with possible matches not yet used or dismissed. They block the run. */
  unreviewed: number;
  /** Identifies the form until it's cleared or replaced (see `useFormId`). */
  formId: string;
  /** Another tab changed the form since: this tab mustn't run it. */
  stale: boolean;
  /** Clears the form once its run is done, ready for the next album. */
  onFinished: () => void;
  /** Where the run button and what it says go: the plan panel beside the form. */
  slot: HTMLElement | null;
  /** Where the run's own cards go in the plan panel: this run, and the recent runs. */
  sideSlot: HTMLElement | null;
  /** The album as the run's summary names it: its label or title. */
  albumName: string;
  /** Told when a run starts, makes progress and ends. */
  onRunning: (r: RunningInfo | null) => void;
  /** Told while the run's QIDs are checked before it starts, so the form is locked then too. */
  onStarting: (starting: boolean) => void;
  /** Told whether a run is on show, e.g. the one that just cleared the form. */
  onShowing: (showing: boolean) => void;
}) {
  const { user } = useAuth();
  // Only a run started from this form writes its QIDs back into it.
  const [ownRun, setOwnRun] = useState(loadOwnRun);
  const ownRunRef = useRef(ownRun);
  const formIdRef = useRef(formId);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // The form was cleared because its run is done: the run stays on show.
  const [cleared, setCleared] = useState(false);
  const keepRun = useRef(false);
  const [runId, setRunId] = useState(() => ownRun?.run ?? null);
  const showing = runId !== null;
  useEffect(() => onShowing(showing), [showing, onShowing]);
  const [run, setRun] = useState<SubmissionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last run ended "unknown": what the server wants done before another.
  const [unknownRun, setUnknownRun] = useState<UnknownRun | null>(null);
  // The run would create items the last run already made, e.g. it was run
  // from another browser: what the server wants done before it goes on.
  const [recreate, setRecreate] = useState<Recreate | null>(null);
  // Items on Wikidata already have identifiers the new items would get.
  const [takenIds, setTakenIds] = useState<TakenIds | null>(null);
  const closeRun = useCallback(() => {
    setCleared(false);
    setRunId(null);
    setRun(null);
    setError(null);
    setUnknownRun(null);
    setRecreate(null);
    setTakenIds(null);
  }, []);
  // A cleared or replaced form starts with no run on show. A run still going
  // is followed in the background, like any own run.
  useEffect(() => {
    if (formIdRef.current === formId) return;
    formIdRef.current = formId;
    if (keepRun.current) {
      keepRun.current = false;
      return;
    }
    closeRun();
  }, [formId, closeRun]);
  // Picking a starting point begins the next album, so a finished run on show
  // closes. A MusicBrainz import replaces the form, which closes it above.
  const startRef = useRef(state.start);
  useEffect(() => {
    const was = startRef.current;
    startRef.current = state.start;
    if (was === null && state.start !== null && run && run.status !== "running") closeRun();
  }, [state.start, run, closeRun]);
  const [starting, setStarting] = useState(false);
  useEffect(() => onStarting(starting), [starting, onStarting]);
  // What the user has confirmed so far for this start, so confirming one
  // conflict doesn't take back another.
  const confirmed = useRef<Omit<SubmissionRequest, "state">>({});

  const followOwnRun = useCallback((o: OwnRun | null) => {
    ownRunRef.current = o;
    setOwnRun(o);
    saveOwnRun(o);
  }, []);
  // Once the own run ends, stop following it, and write its QIDs back if the
  // form is still the one it started from.
  const settle = useCallback(
    (r: SubmissionInfo) => {
      const action = settleOwnRun(r, ownRunRef.current, formIdRef.current);
      if (action === "keep") return;
      followOwnRun(null);
      if (action !== "apply") return;
      // A done run leaves nothing to make, so the form is cleared for the next
      // album. A form changed since the run started is left as it is.
      const after = afterOwnRun(stateRef.current, r);
      if (after === "clear") {
        keepRun.current = true;
        setCleared(true);
        onFinished();
      } else if (after === "apply") update((s) => applyCreated(s, r.edits));
    },
    [followOwnRun, update, onFinished],
  );
  // A run started in another tab on the same form: follow it here too, so its
  // QIDs are saved even if that tab is closed before the run ends.
  useStorageEvent(OWN_RUN_KEY, (saved) => {
    const cur = ownRunRef.current;
    const next = adoptOwnRun(cur, saved);
    if (next?.run === cur?.run && next?.form === cur?.form) return;
    // Not saved again: it came from storage.
    ownRunRef.current = next;
    setOwnRun(next);
    if (next) setRunId((id) => id ?? next.run);
  });
  const dropIfGone = useCallback(
    (id: number, e: unknown) => {
      if (isGone(e) && ownRunRef.current?.run === id) followOwnRun(null);
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
        // A poll that failed and was retried shouldn't leave its error up.
        setError(null);
        settle(r);
      },
      (e) => {
        setError(e instanceof Error ? e.message : "Couldn't load the run.");
        dropIfGone(runId, e);
      },
    );
  }, [runId, loggedIn, settle, dropIfGone]);

  // The own run, while another is on show: a run started in another tab after
  // this form's run cleared it.
  const ownRunId = ownRun?.run ?? null;
  useEffect(() => {
    if (ownRunId === null || ownRunId === runId || !loggedIn) return;
    return watchRun(ownRunId, settle, (e) => dropIfGone(ownRunId, e));
  }, [ownRunId, runId, loggedIn, settle, dropIfGone]);

  const running = run?.status === "running";
  // The own run goes on in the background even when another is on show.
  const runningInfo: RunningInfo | null = running
    ? { done: run.edits.length, total: run.total }
    : loggedIn && ownRunId !== null
      ? { done: 0, total: 0 }
      : null;
  const runDone = runningInfo?.done;
  const runTotal = runningInfo?.total;
  const anyRunning = runningInfo !== null;
  useEffect(() => {
    onRunning(anyRunning ? { done: runDone ?? 0, total: runTotal ?? 0 } : null);
  }, [anyRunning, runDone, runTotal, onRunning]);
  // The user's recent runs, again whenever a run starts or ends.
  const [recent, setRecent] = useState<SubmissionListResponse["submissions"]>([]);
  const runStatus = run?.status;
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    api<SubmissionListResponse>("/api/submissions")
      .then((r) => !cancelled && setRecent(r.submissions))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loggedIn, runId, runStatus]);
  // A run on an existing album is titled with its QID: name it by its label.
  const lookup = useItemSummaries(
    [run?.title ?? "", ...recent.slice(0, RECENT).map((r) => r.title)],
    state.settings.lang,
  );
  const start = (confirm?: Omit<SubmissionRequest, "state">) => {
    setStarting(true);
    setCleared(false);
    setError(null);
    setUnknownRun(null);
    setRecreate(null);
    setTakenIds(null);
    confirmed.current = confirm ? { ...confirmed.current, ...confirm } : {};
    const body: SubmissionRequest = { state, ...confirmed.current };
    api<{ id: number }>("/api/submissions", { method: "POST", body })
      .then(({ id }) => {
        followOwnRun({ run: id, form: formId });
        setRun(null);
        setRunId(id);
      })
      .catch((e: unknown) => {
        const conflict =
          e instanceof FetchError
            ? (e.body as Partial<UnknownRunConflict & RecreateConflict & TakenIdsConflict>)
            : null;
        if (conflict?.unknownRun) setUnknownRun(conflict.unknownRun);
        else if (conflict?.recreate) setRecreate(conflict.recreate);
        else if (conflict?.takenIds) setTakenIds(conflict.takenIds);
        else setError(e instanceof FetchError ? e.message : "Couldn't start the run.");
      })
      .finally(() => setStarting(false));
  };

  const count = plan.ops.length;
  const n = `${count} edit${count === 1 ? "" : "s"}`;
  const edits = useMemo(() => runEdits(plan, state), [plan, state]);
  const noun = releaseNoun(state.album);
  // The run can't start until everything in the checklist is done.
  const blocked = !checklistDone || !user || !plan.ready || stale;
  const disabled = blocked || running || starting;
  const label = starting
    ? "Checking the QIDs…"
    : running
      ? "Running…"
      : count
        ? `Make ${n}`
        : "Make edits";
  const confirm = useRef<ConfirmHandle>(null);
  const openConfirm = (e: MouseEvent<HTMLButtonElement>) => confirm.current?.open(e.currentTarget);
  // A start that's held up says why under the big button, so bring it into view
  // when it was started from the plan panel.
  const held = !!(error || unknownRun || recreate);
  const heldRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (held) heldRef.current?.scrollIntoView({ block: "nearest" });
  }, [held]);
  const errors = plan.messages.filter(([kind]) => kind === "err");
  const titleOf = (title: string) => {
    const found = lookup(title);
    return (found?.status === "ok" && found.label) || title;
  };
  const staleHint = user && stale && (
    <p className="hint">The form was changed in another tab. Reload this page first.</p>
  );
  return (
    <>
      {/* Locked like the steps before it until a starting point is picked, unless a run is on show. */}
      <section
        className={`block create${!state.start && !run && !held ? " locked-step" : ""}`}
        id="create"
      >
        {running ? (
          <div className="create-head">
            <h2>Creating on Wikidata</h2>
            <a href={run.editGroupUrl} target="_blank" rel="noreferrer">
              View this run's EditGroup ↗
            </a>
          </div>
        ) : (
          <h2>Create on Wikidata</h2>
        )}
        {user && cleared && !stale && (
          <p className="hint">The run is done, so the form was cleared for the next run.</p>
        )}
        {run && (
          <RunProgress
            run={run}
            title={titleOf(run.title)}
            onClose={() => {
              setRunId(null);
              setRun(null);
              setCleared(false);
            }}
          />
        )}
        {!running && (
          <>
            {/* Nothing to fix while the steps are locked: the checklist asks for a starting point. */}
            {!state.start ? null : count === 0 ? (
              errors.length ? (
                errors.map(([, text], i) => (
                  <p key={i} className="msg err">
                    {text}
                  </p>
                ))
              ) : (
                <p className="hint">Nothing to create yet.</p>
              )
            ) : (
              <>
                <p className="create-intro">
                  {blocked ? (
                    <>
                      This run will make <b>{n}</b> once everything in the checklist is done.
                    </>
                  ) : (
                    <>
                      Everything checks out. This run makes <b>{n}</b> as <b>{user.username}</b>.
                    </>
                  )}
                </p>
                {unreviewed > 0 && <UnreviewedNotice count={unreviewed} up />}
                <EditBar shares={editShares(edits, albumName)} total={count} />
                <div className="create-go">
                  <button type="button" className="go" disabled={disabled} onClick={openConfirm}>
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <circle cx="9" cy="9" r="8" />
                      <circle cx="9" cy="9" r="3" />
                    </svg>
                    {label}
                  </button>
                  <p className="hint">
                    Please make sure you've checked your tracklist for correctness. Edits will take{" "}
                    {roughly(runSeconds(edits))}.
                  </p>
                </div>
                {staleHint}
              </>
            )}
          </>
        )}
        <div ref={heldRef} id="create-held" className="create-held">
          {error && <p className="msg err">{error}</p>}
          {unknownRun && (
            <UnknownRunGuard
              run={unknownRun}
              disabled={starting}
              onUse={() => {
                const found = {
                  op: "create" as const,
                  ok: true,
                  key: unknownRun.key,
                  qid: unknownRun.qid,
                };
                update((s) => applyCreated(s, [found]));
                setUnknownRun(null);
              }}
              onConfirm={() => start({ confirmUnknown: unknownRun.id })}
            />
          )}
          {recreate && (
            <RecreateGuard
              recreate={recreate}
              noun={noun}
              disabled={starting}
              onUse={() => {
                const found = recreate.created.map((c) => ({
                  op: "create" as const,
                  ok: true,
                  key: c.key,
                  qid: c.qid,
                }));
                update((s) => applyCreated(s, found));
                setRecreate(null);
              }}
              onConfirm={() => start({ confirmRecreate: recreate.id })}
            />
          )}
          {takenIds && (
            <TakenIdsGuard
              takenIds={takenIds}
              disabled={starting}
              onConfirm={() => start({ confirmTakenIds: true })}
            />
          )}
        </div>
        <ConfirmRun
          ref={confirm}
          disabled={disabled}
          plan={plan}
          state={state}
          username={user?.username ?? "you"}
          onConfirm={() => start()}
        />
      </section>
      {count > 0 && <PlannedEdits edits={edits} />}
      {/* A second run button in the plan panel, so it's in view wherever the form is
          scrolled. It opens the same confirm. While a run goes the panel shows the run. */}
      {slot &&
        !running &&
        createPortal(
          <>
            <button type="button" disabled={disabled} onClick={openConfirm}>
              {label}
            </button>
            {held && (
              <p className="hint">
                <a href="#create-held">The run didn't start. See why ↓</a>
              </p>
            )}
            {staleHint}
          </>,
          slot,
        )}
      {sideSlot &&
        createPortal(
          <>
            {running && <ThisRun run={run} username={user?.username ?? ""} />}
            {!running && loggedIn && ownRunId !== null && ownRunId !== runId && (
              <div className="card">
                <div className="kicker">This run</div>
                <p className="hint">Your run is still going.</p>
                <button type="button" className="ghost" onClick={() => setRunId(ownRunId)}>
                  Show it
                </button>
              </div>
            )}
            {user && recent.length > 0 && <RecentRuns runs={recent} titleOf={titleOf} />}
          </>,
          sideSlot,
        )}
    </>
  );
}

/** Opens the run's confirm dialog from whichever run button was pressed. */
interface ConfirmHandle {
  open: (from: HTMLElement) => void;
}

/** The run's confirm. Edits go live on Wikidata, so both run buttons ask first in a modal dialog. */
function ConfirmRun({
  ref,
  disabled,
  plan,
  state,
  username,
  onConfirm,
}: {
  ref: Ref<ConfirmHandle>;
  disabled: boolean;
  plan: Plan;
  state: State;
  username: string;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const from = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  useImperativeHandle(
    ref,
    () => ({
      open(el) {
        from.current = el;
        setOpen(true);
        dialog.current?.showModal();
        // Enter on the default focus shouldn't start the run.
        cancel.current?.focus();
      },
    }),
    [],
  );
  const n = plan.ops.length;
  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={() => {
        setOpen(false);
        from.current?.focus();
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
  );
}

/** How the run's edits split by item type: a stacked bar with a legend. */
function EditBar({ shares, total }: { shares: EditShare[]; total: number }) {
  const legend = (s: EditShare) => `${s.count} ${s.text}${s.extra ? `, ${s.extra}` : ""}`;
  return (
    <div className="edit-mix">
      <div
        className="edit-bar"
        role="img"
        aria-label={`${total} edit${total === 1 ? "" : "s"}: ${shares.map(legend).join(", ")}`}
      >
        {shares.map((s) => (
          <div key={s.kind} style={{ flexGrow: s.edits, background: `var(--${s.edge})` }} />
        ))}
      </div>
      <ul className="edit-legend" aria-hidden="true">
        {shares.map((s) => (
          <li key={s.kind}>
            <i className="sw" style={{ background: `var(--${s.edge})` }} />
            <span>
              <b>{s.count}</b> {s.text}
              {s.extra && <span className="muted"> · {s.extra}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
          twice, then start the run again. If it has been merged, use the item it was merged into.
        </p>
        <div className="row">
          {run.key && (
            <button type="button" onClick={onUse}>
              Use {run.qid} in the form
            </button>
          )}
          <button type="button" className="ghost" disabled={disabled} onClick={onConfirm}>
            It was deleted. Create it again anyway
          </button>
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

/** Shown when the run would create items the user's last run already created. */
function RecreateGuard({
  recreate,
  noun,
  disabled,
  onUse,
  onConfirm,
}: {
  recreate: Recreate;
  /** What the release is called, "album" or "single". */
  noun: string;
  disabled: boolean;
  onUse: () => void;
  onConfirm: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const n = recreate.created.length;
  return (
    <div className="msg warn">
      <p>
        Your{" "}
        <a href={recreate.editGroupUrl} target="_blank" rel="noreferrer">
          last run
        </a>{" "}
        already created {n === 1 ? "this item" : `these ${n} items`} for this {noun}, maybe from
        another browser or device. Use {n === 1 ? "it" : "them"} in the form so{" "}
        {n === 1 ? "it isn't" : "they aren't"} created twice, then start the run again.
      </p>
      <ul>
        {recreate.created.map((c) => (
          <li key={c.key}>
            {c.what} <WikiLink base={wikiBaseUrl} qid={c.qid} />
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" onClick={onUse}>
          Use {n === 1 ? "it" : "them"} in the form
        </button>
        <button type="button" className="ghost" disabled={disabled} onClick={onConfirm}>
          Create {n === 1 ? "it" : "them"} again anyway
        </button>
      </div>
    </div>
  );
}

/** Shown when items on Wikidata already have identifiers the run's new items would get. */
function TakenIdsGuard({
  takenIds,
  disabled,
  onConfirm,
}: {
  takenIds: TakenIds;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const n = takenIds.length;
  return (
    <div className="msg warn">
      <p>
        {n === 1
          ? "An item on Wikidata already has an identifier"
          : "Items on Wikidata already have identifiers"}{" "}
        this run would give its new items. If {n === 1 ? "it's" : "they're"} the same, use{" "}
        {n === 1 ? "it" : "them"} in the form. Some IDs can rightly be on more than one item, such
        as a song item that is both the composition and the recording.
      </p>
      <ul>
        {takenIds.map((t) => (
          <li key={t.text}>
            <TakenIdText base={wikiBaseUrl} taken={t} />
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="ghost" disabled={disabled} onClick={onConfirm}>
          Run anyway
        </button>
      </div>
    </div>
  );
}

/** A taken identifier's sentence, with its QIDs and a MusicBrainz ID linked. */
function TakenIdText({ base, taken }: { base: string; taken: TakenId }) {
  const { text, property, value } = taken;
  const url = property && value ? musicBrainzUrl(property, value) : undefined;
  const at = url ? text.indexOf(value!) : -1;
  if (at < 0) return <Qids base={base}>{text}</Qids>;
  return (
    <>
      <Qids base={base}>{text.slice(0, at)}</Qids>
      <a href={url} target="_blank" rel="noreferrer">
        {value}
      </a>
      <Qids base={base}>{text.slice(at + value!.length)}</Qids>
    </>
  );
}

/**
 * A record spinning while the run goes. The tonearm tracks progress, starting at
 * the outer groove and reaching the label as the last edit is made. Music notes
 * drift up off the record, and a bar on the front of the player fills up.
 */
function Turntable({ done, total }: { done: number; total: number }) {
  const fraction = total > 0 ? Math.min(done / total, 1) : 0;
  // Arm angles that put the needle on the outer groove and next to the label.
  const angle = 20 + fraction * 18;
  return (
    <div
      className="turntable"
      role="progressbar"
      aria-label="Edits made"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total}`}
    >
      {/* Tilted back in 3D, with the front hanging straight down from its near edge. */}
      <div className="deck">
        <svg viewBox="0 0 120 100">
          {/* Square at the front, where it meets the front face. */}
          <path className="plinth" d="M0 100 V4 A4 4 0 0 1 4 0 H116 A4 4 0 0 1 120 4 V100 Z" />
          <circle className="vinyl-edge" cx="50" cy="54" r="42" />
          <g className="record">
            <circle className="vinyl" cx="50" cy="52" r="42" />
            {[38, 33, 28, 23].map((r) => (
              <circle key={r} className="groove" cx="50" cy="52" r={r} />
            ))}
            <path className="sheen" d="M50 52 L50 12 A40 40 0 0 1 78 24 Z" />
            <circle className="label" cx="50" cy="52" r="13" />
            <circle className="label-mark" cx="50" cy="44" r="2" />
            <circle className="spindle" cx="50" cy="52" r="1.5" />
          </g>
          <circle className="pivot-base" cx="106" cy="11" r="8" />
          <g className="tonearm" style={{ transform: `rotate(${angle}deg)` }}>
            {/* The needle riding the grooves. */}
            <g className="jitter">
              {/* The arm floats above the deck, so its shadow falls a little off it. */}
              <g className="arm-shadow" transform="translate(2.5 3)">
                <line x1="106" y1="1" x2="106" y2="70" />
                <rect x="102.5" y="68" width="7" height="9" rx="1.5" />
              </g>
              <line className="arm" x1="106" y1="1" x2="106" y2="70" />
              <line className="arm-shine" x1="105.4" y1="2" x2="105.4" y2="68" />
              <rect className="counterweight" x="102" y="-3" width="8" height="6" rx="1.5" />
              <rect className="headshell" x="102.5" y="68" width="7" height="9" rx="1.5" />
              <rect className="cartridge" x="103.5" y="73" width="5" height="3" rx="0.8" />
            </g>
          </g>
          <circle className="pivot" cx="106" cy="10" r="4" />
        </svg>
        <div className="front">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${fraction * 100}%` }} />
          </div>
        </div>
      </div>
      {/* Outside the SVG so they can drift up past its edge. */}
      <span className="notes" aria-hidden="true">
        <span>♪</span>
        <span>♫</span>
        <span>♪</span>
      </span>
    </div>
  );
}

const RUN_STATUS: Record<SubmissionStatus, { label: string; tone: string }> = {
  running: { label: "Running", tone: "" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Stopped on an error", tone: "bad" },
  interrupted: { label: "Interrupted", tone: "warn" },
  unknown: { label: "Outcome unknown", tone: "warn" },
};

/** Done rows shown under the edit in progress before "Show all N". */
const LATEST = 3;

function StatusIcon({ status }: { status: "done" | "fail" | "unknown" }) {
  const label = { done: "Done", fail: "Failed", unknown: "Outcome unknown" }[status];
  const cls = { done: "ok", fail: "fail", unknown: "problem" }[status];
  return (
    <svg className={`check ${cls}`} width="16" height="16" viewBox="0 0 16 16" role="img">
      <title>{label}</title>
      <circle cx="8" cy="8" r="7" />
      <path
        d={
          status === "done"
            ? "M4.8 8.2l2 2 4.2-4.4"
            : status === "fail"
              ? "M5.5 5.5l5 5M10.5 5.5l-5 5"
              : "M8 4.6v4.2M8 11v.2"
        }
      />
    </svg>
  );
}

/**
 * The run on show: while it goes, the turntable, the count with the time left
 * and per-type progress, and the latest edits. Once it ends, how it ended and
 * every edit it made.
 */
function RunProgress({
  run,
  title,
  onClose,
}: {
  run: SubmissionInfo;
  title: string;
  onClose: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  // Each poll brings a new `run`, but a run's form never changes, so its edits are built once.
  const [planned, setPlanned] = useState(() => ({ id: run.id, edits: plannedEdits(run) }));
  if (planned.id !== run.id) setPlanned({ id: run.id, edits: plannedEdits(run) });
  const info = runProgress(run, planned.id === run.id ? planned.edits : undefined);
  const [all, setAll] = useState(false);
  const done = run.edits.length;
  const running = run.status === "running";
  const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "" };
  // Newest first.
  const rows = run.edits
    .map((e, i) => <LogRow key={i} entry={e} edit={info.edits?.[i] ?? null} run={run} />)
    .reverse();
  const limit = info.next ? LATEST : LATEST + 1;
  const shown = running && !all ? rows.slice(0, limit) : rows;
  return (
    <div className="run">
      <div className="run-box">
        {running && <Turntable done={done} total={run.total} />}
        <div className="run-figures">
          {!running && (
            <div className="run-title">
              <b>{title}</b>
              <span className={`pill ${status.tone}`}>{status.label}</span>
            </div>
          )}
          <span className="run-count">
            {done} <span>of {run.total} edits</span>
          </span>
          {running && <span>{timeLeft(info.secondsLeft)}</span>}
          {info.kinds.length > 0 && (
            <ul className="edit-legend">
              {info.kinds.map((k) => (
                <li key={k.kind}>
                  <i className="sw" style={{ background: `var(--${k.edge})` }} />
                  <span>
                    {k.label} {k.done} / {k.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {run.error && (
        <p className={`msg ${run.status === "unknown" ? "warn" : "err"}`}>{run.error}</p>
      )}
      {run.status === "interrupted" && (
        <p className="msg warn">The server restarted during this run. Start it again to finish.</p>
      )}
      {run.status === "done" && run.artists.length > 0 && <MoreFromArtists run={run} />}
      {!running && (
        <div className="row run-links">
          <a href={run.editGroupUrl} target="_blank" rel="noreferrer">
            View this run's EditGroup ↗
          </a>
          {run.albumQid && (
            <span className="hint">
              {releaseKind(run.input)} <WikiLink base={wikiBaseUrl} qid={run.albumQid} />
            </span>
          )}
          <button type="button" className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {(rows.length > 0 || info.next) && (
        <div className="run-log">
          <div className="run-log-head kicker">{running ? "Latest edits" : "Edits"}</div>
          <ol>
            {info.next && <NextRow edit={info.next} />}
            {shown}
          </ol>
          {running && rows.length > limit && (
            <button type="button" className="run-log-more" onClick={() => setAll((a) => !a)}>
              {all ? "Show the latest only" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What the run's release is, to label its QID: "Album", "EP" or "Single". */
function releaseKind({ album }: State): string {
  if (releaseNoun(album) === "single") return "Single";
  return album.mode === "create" && album.type === EP_CLASS ? "EP" : "Album";
}

/** Once a run is done, links to its artists' pages, to go on to their other releases. */
function MoreFromArtists({ run }: { run: SubmissionInfo }) {
  return (
    <div className="row run-next">
      {run.artists.map((a) => (
        <Link key={a.qid} className="btn" href={`/artists/${a.qid}`}>
          See more from {a.label}
        </Link>
      ))}
    </div>
  );
}

/** The edit being made now. */
function NextRow({ edit }: { edit: PreviewEdit }) {
  return (
    <li className="next">
      <span className="spinner" role="img" aria-label="In progress" />
      <i className="sw" style={{ background: `var(--${KIND_EDGES[edit.kind]})` }} />
      <span className="run-log-text">
        {edit.creates ? (
          <>
            Creating {edit.noun} <b>{edit.title}</b>
          </>
        ) : edit.kind === "album" ? (
          `Adding the ${edit.title.toLowerCase()}`
        ) : (
          <>
            Adding statements to {edit.noun} <b>{edit.title}</b>
          </>
        )}
      </span>
      {edit.place && (
        <span className="muted">
          Disc {edit.place.disc} · {edit.place.n}
        </span>
      )}
    </li>
  );
}

/** A made edit: how it went, and a link to its item. */
function LogRow({
  entry: e,
  edit,
  run,
}: {
  entry: EditLogEntry;
  /** What the plan says the edit was, when it lines up with the log. */
  edit: PreviewEdit | null;
  run: SubmissionInfo;
}) {
  const { wikiBaseUrl } = useAuth();
  const status = e.unknown ? "unknown" : e.ok ? "done" : "fail";
  const what =
    e.op === "create" && edit ? (
      <>
        {edit.noun} <b>{edit.title}</b>
      </>
    ) : (
      e.what
    );
  return (
    <li className={status}>
      <StatusIcon status={status} />
      <i
        className="sw"
        style={{ background: `var(--${KIND_EDGES[edit?.kind ?? entryKind(e)]})` }}
      />
      <span className="run-log-text">
        {e.op === "create" ? (
          <>
            {e.unknown ? "Outcome unknown: created " : e.ok ? "Created " : "Couldn't create "}
            {what}
          </>
        ) : (
          e.what.replace(/^Add /, e.ok ? "Added " : "Couldn't add ")
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
      </span>
      {e.qid && (
        <a href={`${wikiBaseUrl}/wiki/${e.qid}`} target="_blank" rel="noreferrer">
          Open<span className="visually-hidden"> {e.qid}</span> ↗
        </a>
      )}
    </li>
  );
}

/** The plan panel during a run: when it started, and who it edits as. */
function ThisRun({ run, username }: { run: SubmissionInfo; username: string }) {
  return (
    <div className="card this-run">
      <div className="kicker">This run</div>
      <dl>
        <div>
          <dt>Started</dt>
          <dd>{startedAt(run.createdAt)}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{username}</dd>
        </div>
      </dl>
      <p>
        A failed run can be restarted safely if needed. Discographer will automatically avoid
        redoing work or creating duplicate statements.
      </p>
    </div>
  );
}

type RecentRun = SubmissionListResponse["submissions"][number];

/** The user's recent runs, in the plan panel, each linked to its edit group. */
function RecentRuns({ runs, titleOf }: { runs: RecentRun[]; titleOf: (title: string) => string }) {
  return (
    <div className="card recent-runs">
      <div className="kicker" id="recent-runs">
        Your recent runs
      </div>
      <ul aria-labelledby="recent-runs">
        {runs.slice(0, RECENT).map((r) => {
          const status = RUN_STATUS[r.status] ?? { label: r.status, tone: "" };
          return (
            <li key={r.id}>
              <a
                href={r.editGroupUrl}
                target="_blank"
                rel="noreferrer"
                title={`${r.createdAt} UTC`}
              >
                {titleOf(r.title)}
              </a>
              <span className={`pill ${status.tone}`}>{status.label}</span>
            </li>
          );
        })}
      </ul>
      <Link href="/albums">All albums →</Link>
    </div>
  );
}
