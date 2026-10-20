import {
  Fragment,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api, FetchError } from "../lib/client.ts";
import {
  applyMbForm,
  joinList,
  type MbForm,
  type MbReport,
  parseMbInput,
  type ReleaseChoice,
  reportCounts,
} from "../lib/musicbrainz.ts";
import type { State } from "../lib/plan.ts";
import type { MusicBrainzReleaseGroupResponse, MusicBrainzResponse } from "../lib/api-types.ts";
import { useAuth } from "../lib/auth-context.ts";
import { Qids, WikiLink } from "./common.tsx";

const message = (err: unknown, what: string) =>
  err instanceof FetchError && err.status < 500
    ? err.message
    : `Couldn't load the ${what}. ${err instanceof Error ? err.message : ""}`.trim();

/** What the rest of the form can ask of the import. */
export interface MusicBrainzImportHandle {
  /**
   * Lists a release group's releases to pick one, as if its URL were pasted.
   * The release picked, or a release of that group pasted after, is loaded
   * onto `album`, an existing album with that release group.
   */
  loadReleaseGroup: (mbid: string, album: string) => void;
}

/**
 * Loads a MusicBrainz release into the form, replacing what's there, and
 * hands `onLoad` what it found. It stays mounted once the form is started, to
 * load a release group the album section suggests, but only shows its URL
 * field while `showForm`.
 */
export default function MusicBrainzImport({
  state,
  showForm,
  onLoad,
  ref,
}: {
  state: State;
  showForm: boolean;
  onLoad: (next: State, report: MbReport) => void;
  ref?: Ref<MusicBrainzImportHandle>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A pasted release group's releases and the one picked.
  const [group, setGroup] = useState<{
    releases: ReleaseChoice[];
    total: number;
    picked: string;
  } | null>(null);
  // The existing album whose release group was loaded from elsewhere in the
  // form. It outlives the release list, since a release group with too many
  // releases to list asks for the release's URL instead. The server only
  // honors it for a release in that group.
  const albumFor = useRef<{ album: string; releaseGroup: string } | null>(null);
  const pickId = useId();
  const inputId = useId();
  // Set when a release group is loaded from elsewhere in the form, to move
  // focus to its releases once they're listed.
  const focusPick = useRef(false);

  const apply = (form: MbForm) => {
    onLoad(applyMbForm(state, form), form.report);
    setGroup(null);
    setInput("");
    albumFor.current = null;
  };

  // The latest request. The album's suggestion can start one while another
  // is loading, and only the latest may change the form.
  const latest = useRef(0);
  // Clearing the form remounts this, and a load still going mustn't fill the cleared form.
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  const run = async (what: string, fn: (current: () => boolean) => Promise<void>) => {
    const id = ++latest.current;
    const current = () => latest.current === id;
    setError("");
    setBusy(true);
    try {
      await fn(current);
    } catch (err) {
      if (current()) setError(message(err, what));
    } finally {
      if (current()) setBusy(false);
    }
  };

  const loadRelease = (id: string) =>
    run("release", async (current) => {
      const query = albumFor.current ? `?${new URLSearchParams(albumFor.current)}` : "";
      const { form } = await api<MusicBrainzResponse>(`/api/musicbrainz/release/${id}${query}`);
      if (!current()) return;
      apply(form);
    });

  const loadGroup = (id: string) =>
    run("release group", async (current) => {
      const r = await api<MusicBrainzReleaseGroupResponse>(`/api/musicbrainz/release-group/${id}`);
      if (!current()) return;
      setGroup({ ...r, picked: r.releases[0].id });
    });

  const submit = () => {
    const parsed = parseMbInput(input);
    if (!parsed.ok) return setError(parsed.error);
    focusPick.current = false;
    setGroup(null);
    if (parsed.kind === "release") return loadRelease(parsed.id);
    // Another release group isn't the album's.
    if (parsed.id !== albumFor.current?.releaseGroup) albumFor.current = null;
    return loadGroup(parsed.id);
  };

  useImperativeHandle(ref, () => ({
    loadReleaseGroup: (mbid, album) => {
      setInput(`https://musicbrainz.org/release-group/${mbid}`);
      setGroup(null);
      focusPick.current = true;
      albumFor.current = { album, releaseGroup: mbid.toLowerCase() };
      void loadGroup(mbid);
    },
  }));

  useEffect(() => {
    if (!group || !focusPick.current) return;
    focusPick.current = false;
    document.getElementById(pickId)?.focus({ preventScroll: true });
  }, [group, pickId]);

  return (
    <>
      {showForm && (
        <div className="start-panel">
          <div className="start-panel-head">
            <label htmlFor={inputId}>MusicBrainz release or release group URL</label>
            <a
              href="https://musicbrainz.org/search?type=release_group"
              target="_blank"
              rel="noreferrer"
            >
              Search on MusicBrainz ↗
            </a>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              id={inputId}
              type="text"
              spellCheck={false}
              className="mb-input mono"
              placeholder="https://musicbrainz.org/release-group/…"
              aria-invalid={!!error}
              aria-describedby={`${inputId}-sub`}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setGroup(null);
              }}
            />
            <button
              type="submit"
              className={group ? "ghost" : undefined}
              disabled={busy || !input.trim()}
            >
              {busy && !group ? "Loading…" : "Load"}
            </button>
          </form>
          <span className="sub" id={`${inputId}-sub`}>
            Fills in the album, tracklist, performers and identifiers in one go. A release group
            asks which of its releases has the tracklist you want.
          </span>
          {group && (
            <form
              className="mb-pick"
              onSubmit={(e) => {
                e.preventDefault();
                void loadRelease(group.picked);
              }}
            >
              <label className="f" htmlFor={pickId}>
                Release
              </label>
              <div className="row">
                <select
                  id={pickId}
                  className="mb-input"
                  value={group.picked}
                  onChange={(e) => setGroup({ ...group, picked: e.target.value })}
                >
                  {group.releases.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {i === 0 ? `${r.label} (suggested)` : r.label}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={busy}>
                  {busy ? "Loading…" : "Load this release"}
                </button>
              </div>
              <span className="sub">
                {group.total > group.releases.length
                  ? `${group.releases.length} of ${group.total} releases. If yours isn't listed, paste its release URL.`
                  : `${group.total} release${group.total === 1 ? "" : "s"}. The suggestion is the earliest official plain edition, digital or CD if there is one.`}
              </span>
            </form>
          )}
          {error && <p className="msg err">{error}</p>}
        </div>
      )}
    </>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Nodes joined as a list in a sentence: "a, b and c". */
function joinNodes(xs: ReactNode[]) {
  return xs.map((x, i) => (
    <Fragment key={i}>
      {i > 0 && (i === xs.length - 1 ? " and " : ", ")}
      {x}
    </Fragment>
  ));
}

const ICONS = {
  warn: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="warn">
      <path d="M9 1.8l7.6 13.4H1.4z" />
      <path d="M9 7v3.8M9 13v.2" />
    </svg>
  ),
  leftOff: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="left-off">
      <circle cx="9" cy="9" r="7.5" />
      <path d="M9 8v5M9 5.3v.2" />
    </svg>
  ),
  ok: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="ok">
      <circle cx="9" cy="9" r="8" />
      <path d="M5.4 9.2l2.4 2.4 4.8-5" />
    </svg>
  ),
  ids: (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="ids">
      <rect x="2" y="3" width="14" height="12" rx="2" />
      <path d="M5 7h8M5 10h5" />
    </svg>
  ),
};

/** Up to five tracks, listed. More are a count, with a button to list them. */
function SkippedTracks({
  titles,
  every,
  reused,
}: {
  titles: string[];
  /** Every new track is one of them. */
  every: boolean;
  /** Some tracks are reused, so "every track" would overstate it. */
  reused: boolean;
}) {
  const [shown, setShown] = useState(false);
  const list = titles.join(", ");
  if (titles.length <= 5) return list;
  return (
    <>
      <span className="mb-skip-all">
        {every ? (reused ? "Every new track" : "Every track") : plural(titles.length, "track")}
        <button
          type="button"
          className="link"
          aria-expanded={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? "Hide" : `Show ${titles.length}`}
        </button>
      </span>
      {shown && <span className="mb-skip-list">{list}</span>}
    </>
  );
}

function ReportSection({
  icon,
  title,
  children,
}: {
  icon: keyof typeof ICONS;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-report-sec">
      {ICONS[icon]}
      <h3>{title}</h3>
      <div className="mb-report-body">{children}</div>
    </div>
  );
}

/** What the last MusicBrainz load found and filled in, a section for each kind of thing. */
export function ImportReport({ id, report }: { id?: string; report: MbReport }) {
  const { wikiBaseUrl } = useAuth();
  const { misplaced, severalLinks, severalAlbumLinks, found, added, extended, references, notes } =
    report;
  const counts = reportCounts(report);
  const leftOff = severalLinks.reduce((n, l) => n + l.titles.length, severalAlbumLinks.length);

  const kinds = new Set(misplaced.map((m) => m.kind));
  const holders = kinds.size === 1 ? `${[...kinds][0]}s` : "items";
  const oneHolder = misplaced.length === 1;
  // Said once here rather than on every row, so the rows stay on one line.
  const toNew = new Set(misplaced.filter((m) => m.newComp).map((m) => m.title));
  const newComps = !toNew.size
    ? ""
    : misplaced.some((m) => !m.newComp)
      ? " Where no composition has the work ID yet, the new one gets it instead."
      : toNew.size === 1
        ? " The new composition gets the work ID instead."
        : " The new compositions get the work IDs instead.";

  const foundParts: ReactNode[] = [
    found.album && (
      <>
        the album <WikiLink base={wikiBaseUrl} qid={found.album} />
      </>
    ),
    found.artists > 0 && plural(found.artists, "artist"),
    found.compositions > 0 && plural(found.compositions, "composition"),
    found.tracks > 0 && plural(found.tracks, "track"),
  ].filter(Boolean);

  const idRows: [string, string[] | MbReport["added"]["tracks"]][] = [
    ["New album", added.album],
    ["New tracks", added.tracks],
    ["New compositions", added.compositions],
    ["Found tracks", extended.tracks],
    ["Found compositions", extended.compositions],
  ];
  const extending = extended.tracks.length + extended.compositions.length > 0;

  return (
    <div className="mb-report" id={id}>
      {misplaced.length > 0 && (
        <ReportSection icon="warn" title={`Fix on Wikidata · ${misplaced.length}`}>
          <p>
            {oneHolder ? `This ${misplaced[0].kind} has` : `These ${holders} have`} a composition's
            work ID. Consider removing {oneHolder ? "it" : "them"} on Wikidata, as only a
            composition should have one.{newComps}
          </p>
          <ul className="mb-fix">
            {misplaced.map((m) => (
              <li key={`${m.qid} ${m.title}`}>
                <span className="mono">
                  <WikiLink base={wikiBaseUrl} qid={m.qid} />
                </span>
                <span>{m.kind}</span>
                <span className="muted">has the work ID for</span>
                <b>“{m.title}”</b>
                <a
                  className="mb-fix-open"
                  href={`${wikiBaseUrl}/wiki/${m.qid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on Wikidata ↗
                </a>
              </li>
            ))}
          </ul>
        </ReportSection>
      )}
      {notes.length > 0 && (
        <ReportSection icon="warn" title={`Check in the form · ${notes.length}`}>
          {notes.map((n) => (
            <p key={n}>
              <Qids base={wikiBaseUrl}>{n}</Qids>
            </p>
          ))}
        </ReportSection>
      )}
      {leftOff > 0 && (
        <ReportSection icon="leftOff" title={`IDs left off · ${leftOff}`}>
          {severalAlbumLinks.map((l) => (
            <p key={l.what}>
              The {l.from} links {l.n} {l.what}, so none was filled in. Add the right one under
              Album.
            </p>
          ))}
          {severalLinks.length > 0 && (
            <>
              <p>
                MusicBrainz links multiple IDs for some tracks, so these IDs will be left off the
                following tracks:
              </p>
              <dl className="mb-skip">
                {severalLinks.map((l) => (
                  <Fragment key={l.service}>
                    <dt>{l.service}</dt>
                    <dd>
                      <SkippedTracks
                        titles={l.titles}
                        every={l.titles.length === report.newTracks}
                        reused={found.tracks > 0}
                      />
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <p className="mb-report-aside">The tracks will still be created.</p>
            </>
          )}
        </ReportSection>
      )}
      {counts.found > 0 && (
        <ReportSection icon="ok" title="Already on Wikidata">
          <p>
            Matched by MusicBrainz ID: {joinNodes(foundParts)}. {counts.found === 1 ? "It" : "They"}{" "}
            will be reused.
          </p>
        </ReportSection>
      )}
      {counts.added > 0 && (
        <ReportSection icon="ids" title="Identifiers added">
          <dl className="mb-ids">
            {idRows.map(
              ([what, ids]) =>
                ids.length > 0 && (
                  <Fragment key={what}>
                    <dt>{what}</dt>
                    <dd>
                      {ids.map((c) =>
                        typeof c === "string" ? (
                          <span key={c} className="mb-count">
                            {c}
                          </span>
                        ) : (
                          <span key={c.label} className="mb-count">
                            <b>{c.n}</b> {c.label}
                          </span>
                        ),
                      )}
                    </dd>
                  </Fragment>
                ),
            )}
          </dl>
          {extending && (
            <p className="mb-report-aside">Found items get the ID unless they already have one.</p>
          )}
          {references.length > 0 && (
            <p className="mb-refs">
              <span className="mb-badge" aria-hidden="true">
                MB
              </span>
              The imported {joinList(references)} get a MusicBrainz reference.
            </p>
          )}
        </ReportSection>
      )}
    </div>
  );
}
