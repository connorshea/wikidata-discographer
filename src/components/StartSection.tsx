// The form's first step: a picker of where to start from, which collapses into
// a summary bar once one is applied.
import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import {
  ALBUM_TYPES,
  EP_CLASS,
  QID,
  setAlbumType,
  type StartingPoint,
  type State,
} from "../lib/plan.ts";
import { startSummary } from "../lib/progress.ts";
import { FieldErr, QidInput } from "./common.tsx";
import { AlbumArtists } from "./AlbumSection.tsx";
import MusicBrainzImport, { type MusicBrainzImportHandle } from "./MusicBrainzImport.tsx";
import type { SectionProps } from "./types.ts";

/** What the rest of the form can ask of the start step. */
export interface StartHandle {
  /** Back to the picker, with `card` picked, keeping the rest of the form. */
  change: (card?: StartingPoint) => void;
  /** Back to the picker to load a release group onto an existing album (see MusicBrainzImport). */
  loadReleaseGroup: (mbid: string, album: string) => void;
}

const OPTIONS: { id: StartingPoint; title: string; desc: string; icon: string }[] = [
  {
    id: "mb",
    title: "MusicBrainz release",
    desc: "Paste a MusicBrainz link and most info will auto-fill for you",
    icon: "M10 3v9M6.5 8.5L10 12l3.5-3.5M4 13.5V16h12v-2.5",
  },
  {
    id: "existing",
    title: "Existing album QID",
    desc: "An album on Wikidata with no tracklist yet",
    icon: "M4 4h12v12H4zM7 10l2 2 4-4",
  },
  {
    id: "search",
    title: "Search by name",
    desc: "Find an album or EP already on Wikidata",
    icon: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5L17 17",
  },
  {
    id: "new",
    title: "New album from scratch",
    desc: "Create the album item along with its tracks",
    icon: "M10 4v12M4 10h12",
  },
];

function StartIcon({ start, on }: { start: StartingPoint; on: boolean }) {
  return (
    <span className={`start-icon${on ? " on" : ""}`} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20">
        <path d={OPTIONS.find((o) => o.id === start)!.icon} />
      </svg>
    </span>
  );
}

export default function StartSection({
  state,
  update,
  plan,
  needsConfirm,
  albumLabel,
  onLoad,
  ref,
}: SectionProps & {
  needsConfirm: boolean;
  /** The existing album's label on Wikidata, while it's known. */
  albumLabel: string | null;
  onLoad: (next: State) => void;
  ref?: Ref<StartHandle>;
}) {
  const picking = !state.start;
  const [card, setCard] = useState<StartingPoint | null>(null);
  // The starting point Change left, to go back to it.
  const [prev, setPrev] = useState<StartingPoint | null>(null);
  const mbImport = useRef<MusicBrainzImportHandle>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  // Set by Change, to move focus to the picker once it's shown.
  const focusHead = useRef(false);

  const change = (to?: StartingPoint) => {
    if (state.start) setPrev(state.start);
    setCard(to ?? state.start);
    focusHead.current = true;
    update((s) => void (s.start = null));
  };

  useImperativeHandle(ref, () => ({
    change,
    loadReleaseGroup: (mbid, album) => {
      change("mb");
      sectionRef.current?.scrollIntoView({ block: "start" });
      mbImport.current?.loadReleaseGroup(mbid, album);
    },
  }));

  useEffect(() => {
    if (!picking || !focusHead.current) return;
    focusHead.current = false;
    headRef.current?.focus({ preventScroll: true });
  }, [picking]);

  const summary = startSummary(state, plan, albumLabel);
  return (
    <section className={`block start${picking ? "" : " started"}`} id="start" ref={sectionRef}>
      {picking ? (
        <>
          <div className="start-head">
            <div>
              <h2 tabIndex={-1} ref={headRef}>
                How do you want to start?
              </h2>
              <p className="hint">
                Pick a starting point. You can still change anything in the form afterwards.
              </p>
            </div>
            {/* Back to the starting point Change left, with nothing changed. */}
            {prev && (
              <button
                type="button"
                className="link start-change"
                onClick={() => update((s) => void (s.start = prev))}
              >
                Cancel
              </button>
            )}
          </div>
          <div className="start-cards" role="radiogroup" aria-label="Starting point">
            {OPTIONS.map((o) => (
              <label className="start-card" key={o.id}>
                <input
                  type="radio"
                  name="start"
                  className="visually-hidden"
                  checked={card === o.id}
                  onChange={() => setCard(o.id)}
                />
                <StartIcon start={o.id} on={card === o.id} />
                <span className="start-card-text">
                  <b>{o.title}</b>
                  <span>{o.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : (
        summary && (
          <div className="start-bar">
            <StartIcon start={state.start!} on />
            <div className="start-bar-text">
              <span className="kicker">{summary.from}</span>
              <span>
                <b>{summary.title}</b>
                {summary.details.length > 0 && (
                  <span className="muted"> · {summary.details.join(" · ")}</span>
                )}
              </span>
            </div>
            <button type="button" className="link start-change" onClick={() => change()}>
              Change
            </button>
          </div>
        )
      )}
      {picking && card === "existing" && <ExistingPanel state={state} update={update} />}
      {picking && card === "search" && <SearchPanel onPick={setCard} />}
      {picking && card === "new" && <NewPanel state={state} update={update} />}
      <MusicBrainzImport
        ref={mbImport}
        state={state}
        needsConfirm={needsConfirm}
        showForm={picking && card === "mb"}
        onLoad={onLoad}
      />
    </section>
  );
}

/** An existing album, by its QID or Wikidata URL. */
function ExistingPanel({ state, update }: Omit<SectionProps, "plan">) {
  const id = useId();
  const [qid, setQid] = useState(state.album.mode === "existing" ? state.album.qid : "");
  const [error, setError] = useState("");
  return (
    <form
      className="start-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const q = qid.trim();
        if (!QID.test(q)) return setError("Enter a QID such as Q42, or the album's Wikidata URL.");
        update((s) => {
          s.album.mode = "existing";
          s.album.qid = q;
          s.start = "existing";
        });
      }}
    >
      <label htmlFor={id}>Album QID or Wikidata URL</label>
      <div className="row">
        <QidInput
          id={id}
          className="mono qid-field"
          placeholder="Q…"
          value={qid}
          aria-invalid={!!error}
          aria-describedby={`${id}-sub ${id}-err`}
          onChange={(v) => {
            setQid(v);
            setError("");
          }}
        />
        <button type="submit" disabled={!qid.trim()}>
          Use this album
        </button>
      </div>
      <span className="sub" id={`${id}-sub`}>
        The album must not have a tracklist yet. If it's on MusicBrainz, you'll be offered to load
        it from there.
      </span>
      <FieldErr id={id} msg={error} />
    </form>
  );
}

/**
 * A search of the albums and EPs already on Wikidata, by title. Only the
 * field for now: the results, and picking one (which sets `start` to
 * "search"), are still to come.
 */
function SearchPanel({ onPick }: { onPick: (card: StartingPoint) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  return (
    <div className="start-panel">
      <label htmlFor={id}>Album or EP title</label>
      <input
        id={id}
        type="search"
        value={query}
        aria-describedby={`${id}-sub`}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="sub" id={`${id}-sub`}>
        Albums and EPs already on Wikidata
      </span>
      {query.trim() && (
        <p className="msg summary" role="status">
          Searching by name isn't ready yet. For now,{" "}
          <button type="button" className="link" onClick={() => onPick("existing")}>
            enter the album's QID
          </button>
          .
        </p>
      )}
      <span className="sub">
        Not listed?{" "}
        <button type="button" className="link" onClick={() => onPick("new")}>
          Create it as a new album
        </button>
        .
      </span>
    </div>
  );
}

/** The basics of a new album. The rest of it is filled in in the Album section. */
function NewPanel({ state, update }: Omit<SectionProps, "plan">) {
  const A = state.album;
  return (
    <div className="start-panel">
      <div className="grid">
        <label className="f">
          Title
          <input
            type="text"
            value={A.title}
            onChange={(e) => update((s) => void (s.album.title = e.target.value))}
          />
        </label>
        <AlbumArtists state={state} update={update} error={undefined} />
        <label className="f">
          Type
          <select value={A.type} onChange={(e) => update((s) => setAlbumType(s, e.target.value))}>
            {ALBUM_TYPES.map(([q]) => (
              <option key={q} value={q}>
                {q === EP_CLASS ? "EP" : "Album"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="sub">
        Form, identifiers and the description template come next in the Album section.
      </span>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            update((s) => {
              s.album.mode = "create";
              s.start = "new";
            })
          }
        >
          Continue
        </button>
      </div>
    </div>
  );
}
