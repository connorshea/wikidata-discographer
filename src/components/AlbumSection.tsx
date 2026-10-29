import { Fragment, useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import {
  albumArtists,
  albumDescPreview,
  ALBUM_FORMS,
  ALBUM_TYPES,
  QID,
  capitalized,
  citesMb,
  EP_CLASS,
  loadedReleaseGroup,
  releaseNoun,
  setAlbumType,
  SINGLE_CLASS,
} from "../lib/plan.ts";
import { isIdReason } from "../lib/matches.ts";
import { ALBUM_ID_FIELDS, type AlbumIdKey, normalizeAlbumId } from "../lib/music.ts";
import type { DuplicateMatch, DuplicatesRequest, DuplicatesResponse } from "../lib/api-types.ts";
import { FieldErr, InfoTip, Pids, QidInput, WikiLink } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import {
  albumProblem,
  type ItemLookup,
  releaseKind,
  takenFromProblem,
  useItemSummaries,
} from "./use-item-summaries.ts";
import type { SectionProps } from "./types.ts";
import type { AlbumTracklist } from "./use-album-tracklist.ts";

export default function AlbumSection({
  state,
  update,
  plan,
  found,
  albumTracklist,
  checked,
  releaseGroup,
  takenFrom,
  reloading,
  onReload,
  onLoadReleaseGroup,
  onPickAnother,
}: SectionProps & {
  /** The existing album, as Wikidata describes it. */
  found: ItemLookup | undefined;
  albumTracklist: AlbumTracklist | null;
  /** Whether Wikidata was asked if the existing album has a tracklist. */
  checked: boolean;
  /** The existing album's MusicBrainz release group, to suggest loading it. */
  releaseGroup: string | null;
  /** The albums the existing single is already taken from. */
  takenFrom: string[];
  /** Whether the existing album is being looked up on Wikidata. */
  reloading: boolean;
  /** Look the existing album up on Wikidata again, after it's been fixed there. */
  onReload: () => void;
  onLoadReleaseGroup: (mbid: string, album: string) => void;
  /** Back to the starting-point picker, to pick another album. */
  onPickAnother: () => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const A = state.album;
  const errs = plan.fieldErrs;
  const notAlbum = albumProblem(A.qid, found);
  const qid = A.qid.trim();
  const problem = errs.albumQid || notAlbum;
  const ok = found?.status === "ok" ? found : null;
  // A single is called one throughout. An EP is called an album, as it always has been.
  const noun = releaseNoun(A);
  const Noun = capitalized(noun);
  return (
    <section className="block" id="album">
      <div className="album-head">
        <h2>
          <span className="sw" style={{ background: "var(--disc-edge)" }} aria-hidden="true" />
          {Noun}
        </h2>
        <span className="sub">
          {A.mode === "create"
            ? `New ${noun}`
            : state.start === "mb"
              ? "Found on Wikidata through the MusicBrainz release group"
              : `Existing ${noun}`}
        </span>
      </div>
      {A.mode === "existing" ? (
        <>
          <div className={`album-card${problem || albumTracklist ? " bad" : ""}`}>
            <div className="album-card-text">
              <div className="album-card-title">
                {QID.test(qid) ? (
                  <a
                    className="qid-chip mono"
                    href={`${wikiBaseUrl}/wiki/${qid}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on Wikidata"
                  >
                    {qid}
                  </a>
                ) : (
                  qid && <span className="qid-chip mono">{qid}</span>
                )}
                <b>{ok?.label ?? (found?.status === "loading" ? "Loading…" : "")}</b>
              </div>
              {ok?.description && <div className="muted">{ok.description}</div>}
              {ok && !notAlbum && (
                <ul className="pills" aria-label={`About this ${noun}`}>
                  <li className="pill">{releaseKind(ok.classes)}</li>
                  {checked && !albumTracklist && <li className="pill ok">No tracklist yet</li>}
                </ul>
              )}
            </div>
            {QID.test(qid) && (
              <div className="album-card-actions">
                <button
                  type="button"
                  className="ghost album-card-reload"
                  disabled={reloading}
                  onClick={onReload}
                >
                  {reloading ? "Reloading…" : "Reload from Wikidata"}
                </button>
              </div>
            )}
          </div>
          {(problem || albumTracklist) && (
            <p className="album-err" id="albumQid-err">
              <span>
                {albumTracklist
                  ? `This ${noun} already has a tracklist with ${albumTracklist.tracks.length} track${albumTracklist.tracks.length === 1 ? "" : "s"}. Adding another would list its songs twice, so it can't be used.`
                  : problem}{" "}
                <button type="button" className="link" onClick={onPickAnother}>
                  Pick a different {noun}
                </button>
              </span>
            </p>
          )}
          {/* Not once it's loaded, but still if it was only typed in for a new album. */}
          {releaseGroup && !loadedReleaseGroup(state, releaseGroup) && (
            <div className="album-mb" role="region" aria-labelledby="album-mb-head">
              <span className="mb-badge" aria-hidden="true">
                MB
              </span>
              <div className="album-mb-text">
                <b id="album-mb-head">
                  This {noun} is on{" "}
                  <a
                    href={`https://musicbrainz.org/release-group/${releaseGroup}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    MusicBrainz ↗
                  </a>
                </b>
                <span>Load it to fill in the tracklist, performers and identifiers.</span>
              </div>
              <button type="button" onClick={() => onLoadReleaseGroup(releaseGroup, A.qid)}>
                Load from MusicBrainz
              </button>
            </div>
          )}
          {noun === "single" && !problem && !albumTracklist && (
            <div className="grid">
              <TakenFrom state={state} update={update} plan={plan} already={takenFrom} />
            </div>
          )}
        </>
      ) : (
        <div className="album-new">
          <Duplicates state={state} update={update} noun={noun} />
          <div className="grid">
            <label className="f">
              Title
              <input
                type="text"
                value={A.title}
                aria-invalid={!!errs.albumTitle}
                aria-describedby="albumTitle-err"
                onChange={(e) => update((s) => void (s.album.title = e.target.value))}
              />
              <FieldErr id="albumTitle" msg={errs.albumTitle} />
            </label>
            <ArtistChips state={state} update={update} error={errs.albumArtists} />
            <AlbumTypeSelect state={state} update={update} />
            {/* A single has no album form. */}
            {A.type !== SINGLE_CLASS && (
              <label className="f">
                Form
                <select
                  value={A.form}
                  onChange={(e) => update((s) => void (s.album.form = e.target.value))}
                >
                  <option value="">None</option>
                  {ALBUM_FORMS.map(([q, l]) => (
                    <option key={q} value={q}>
                      {l[0].toUpperCase() + l.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {A.type === SINGLE_CLASS && (
              <TakenFrom state={state} update={update} plan={plan} already={[]} />
            )}
          </div>
          <div className="f">
            <div className="f-head">
              <label htmlFor="albumDesc">Description</label>
              <InfoTip id="albumDesc">
                Write the description as plain text. Anything else in braces is an error.
                <dl>
                  <dt>{"{year}"}</dt>
                  <dd>Year of the publication date in Item settings. Needs a publication date.</dd>
                  <dt>{"{type}"}</dt>
                  <dd>
                    The form, e.g. “studio album”, or “album” or “EP” when there's no form. An EP
                    says “EP” in place of “album”, e.g. “live EP”. A single is always “single”.
                  </dd>
                  <dt>{"{artists}"}</dt>
                  <dd>The {noun} artists, joined like “A, B and C”.</dd>
                </dl>
              </InfoTip>
            </div>
            <div className="album-desc">
              <div>
                <input
                  id="albumDesc"
                  type="text"
                  className="mono"
                  value={state.settings.albumDesc}
                  aria-invalid={!!errs.albumDesc}
                  aria-describedby="albumDesc-preview albumDesc-err"
                  onChange={(e) => update((s) => void (s.settings.albumDesc = e.target.value))}
                />
                <FieldErr id="albumDesc" msg={errs.albumDesc} />
              </div>
              <span className="desc-preview" id="albumDesc-preview">
                <span className="visually-hidden">Preview: </span>
                {albumDescPreview(state)}
              </span>
            </div>
          </div>
          <AlbumIds state={state} update={update} plan={plan} />
          <p className="hint">
            <Pids>
              {`The ${noun} is created first with P31, ${A.type === SINGLE_CLASS ? "" : "P7937, "}` +
                "P1476, P175, P577 (publication date), P407, the identifiers above, P437 music " +
                "streaming when there's a Spotify, Apple Music, Deezer or Tidal ID, and P2635 " +
                "number of tracks: one statement per disc qualified with its part when every disc " +
                "has a part, otherwise one total." +
                (A.type === SINGLE_CLASS && A.takenFrom.trim()
                  ? " A single also gets P13602, the album it's taken from."
                  : "")}
            </Pids>
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The album a single is taken from (P13602), with its label once Wikidata has been asked.
 * A single already taken from other albums keeps them, and gets this one as well.
 */
function TakenFrom({ state, update, plan, already }: SectionProps & { already: string[] }) {
  const { wikiBaseUrl } = useAuth();
  const A = state.album;
  const qid = A.takenFrom.trim();
  const others = already.filter((q) => q !== qid);
  const lookup = useItemSummaries([qid, ...others], state.settings.lang);
  const found = lookup(qid);
  const ok = found?.status === "ok" ? found : null;
  const err = plan.fieldErrs.takenFrom;
  const warning = ok && !err ? takenFromProblem(ok.classes) : null;
  const name = (q: string) => {
    const f = lookup(q);
    return f?.status === "ok" && f.label ? f.label : q;
  };
  return (
    <div className="f taken-from">
      <label htmlFor="takenFrom">Taken from</label>
      <QidInput
        id="takenFrom"
        className={warning ? "mono warn" : "mono"}
        value={A.takenFrom}
        aria-invalid={!!err || found?.status === "missing" || found?.status === "redirect"}
        aria-describedby="takenFrom-err takenFrom-sub"
        onChange={(v) => update((s) => void (s.album.takenFrom = v))}
      />
      {ok && !err && (
        <span className="taken-from-hit">
          <b>{ok.label ?? qid}</b>
          {ok.description && <span className="muted">{ok.description}</span>}
          <a
            href={`${wikiBaseUrl}/wiki/${qid}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${qid} on Wikidata`}
          >
            ↗
          </a>
        </span>
      )}
      {warning && (
        <span className="warn-note taken-from-warn">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.5l7 12.5H1z" />
            <path d="M8 6.2v3.6M8 11.8v.2" />
          </svg>
          {warning}
        </span>
      )}
      {found?.status === "redirect" && !err ? (
        <span className="field-err" id="takenFrom-err" aria-live="polite">
          {qid} redirects to <WikiLink base={wikiBaseUrl} qid={found.to} />.{" "}
          <button
            type="button"
            className="link"
            onClick={() => update((s) => void (s.album.takenFrom = found.to))}
          >
            Use {found.to}
          </button>
        </span>
      ) : (
        <FieldErr
          id="takenFrom"
          msg={err || (found?.status === "missing" ? `${qid} doesn't exist on Wikidata.` : "")}
        />
      )}
      <span className="sub with-badge" id="takenFrom-sub">
        {citesMb(state, A.mb?.takenFrom, qid) ? (
          <>
            <span className="mb-badge" aria-hidden="true">
              MB
            </span>
            From the single's “single from” relationship on MusicBrainz
          </>
        ) : qid && already.includes(qid) ? (
          "The single is already taken from this album, so nothing is added."
        ) : others.length ? (
          <span>
            Already taken from{" "}
            {others.map((q, i) => (
              <Fragment key={q}>
                {i > 0 && (i === others.length - 1 ? " and " : ", ")}
                <a href={`${wikiBaseUrl}/wiki/${q}`} target="_blank" rel="noreferrer">
                  {name(q)}
                </a>
              </Fragment>
            ))}
            .{" "}
            {qid
              ? `That stays, and this adds ${ok?.label ?? qid}, since a single can be on more than one album.`
              : "That stays. Add another album here, or leave it empty."}
          </span>
        ) : (
          "Optional. The album's QID or Wikidata link. Left empty, nothing is added."
        )}
      </span>
    </div>
  );
}

/** A new album's type: Album, EP or Single. */
export function AlbumTypeSelect({ state, update }: Pick<SectionProps, "state" | "update">) {
  return (
    <label className="f">
      Type
      <select
        value={state.album.type}
        onChange={(e) => update((s) => setAlbumType(s, e.target.value))}
      >
        {ALBUM_TYPES.map(([q]) => (
          <option key={q} value={q}>
            {q === EP_CLASS ? "EP" : q === SINGLE_CLASS ? "Single" : "Album"}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A new album's identifiers. The ones a MusicBrainz import filled in show
 * first, with an MB badge while they still get a MusicBrainz reference. The
 * rest wait behind "+ N more", unless one of them already has a value.
 */
function AlbumIds({ state, update, plan }: SectionProps) {
  const A = state.album;
  const errs = plan.fieldErrs;
  const imported = (key: AlbumIdKey) => !!A.mb && (key === "musicbrainz" || !!A.mb.ids[key]);
  const [open, setOpen] = useState(() =>
    ALBUM_ID_FIELDS.some((f) => !imported(f.key) && A.ids[f.key].trim()),
  );
  const shown = ALBUM_ID_FIELDS.filter((f) => open || imported(f.key));
  const more = ALBUM_ID_FIELDS.filter((f) => !shown.includes(f));
  const fromMb = (key: AlbumIdKey) => {
    const v = A.ids[key].trim();
    return key === "musicbrainz"
      ? A.mode === "create" && !!A.mb && normalizeAlbumId("musicbrainz", v) === A.mb.releaseGroup
      : citesMb(state, A.mb?.ids[key], v);
  };
  const short = (label: string) => label.replace(/ (album|release group|master) ID$/, "");
  return (
    <div className="album-ids">
      <h3 className="kicker">Identifiers</h3>
      {shown.length > 0 && (
        <div className="grid">
          {shown.map((f) => (
            <label className="f" key={f.key}>
              <span className="with-badge">
                {f.label.replace(/ ID$/, "")}
                {fromMb(f.key) && (
                  <span
                    className="mb-badge"
                    title="From MusicBrainz. Gets a MusicBrainz reference while it stays the same."
                  >
                    MB
                  </span>
                )}
              </span>
              <input
                type="text"
                className="mono"
                spellCheck={false}
                value={A.ids[f.key]}
                aria-invalid={!!errs[`albumId-${f.key}`]}
                aria-describedby={`albumId-${f.key}-err album-ids-sub`}
                onChange={(e) =>
                  update((s) => void (s.album.ids[f.key] = normalizeAlbumId(f.key, e.target.value)))
                }
              />
              <FieldErr id={`albumId-${f.key}`} msg={errs[`albumId-${f.key}`]} />
            </label>
          ))}
        </div>
      )}
      {more.length > 0 && (
        <button
          type="button"
          className="link ids-more"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {shown.length ? `+ ${more.length} more` : "+ Add identifiers"}:{" "}
          {more.map((f) => short(f.label)).join(", ")}
        </button>
      )}
      <span className="sub" id="album-ids-sub">
        Optional. Paste an ID or a link. Each one is checked against Wikidata for duplicates.
      </span>
    </div>
  );
}

/**
 * Albums in the mirror that share an identifier or the title with the one being
 * created, strongest first. Once the album artists have QIDs, same-title albums
 * by someone else are left out. Any identifier match makes it red, and the
 * first such album gets the primary button.
 */
function Duplicates({ state, update, noun }: Omit<SectionProps, "plan"> & { noun: string }) {
  const { wikiBaseUrl } = useAuth();
  const A = state.album;
  // Debounce the serialized request: a fresh object every render would never settle.
  const key = useDebounced(
    JSON.stringify({
      title: A.title,
      // A single often shares its title with the album it's taken from, so each looks only at its own kind.
      kinds: noun === "single" ? ["single"] : ["album", "ep"],
      ids: Object.fromEntries(ALBUM_ID_FIELDS.map((f) => [f.property, A.ids[f.key]])),
      performers: albumArtists(state)
        .map((a) => (state.artists[a] ?? "").trim())
        .filter((q) => QID.test(q)),
    } satisfies DuplicatesRequest),
  );
  // Results are tagged with the request they answer, so stale ones are never shown.
  const [result, setResult] = useState<{ key: string; matches: DuplicateMatch[] } | null>(null);
  const req = JSON.parse(key) as DuplicatesRequest;
  const empty = !req.title.trim() && !Object.values(req.ids).some((v) => v.trim());
  useEffect(() => {
    if (empty) return;
    let cancelled = false;
    api<DuplicatesResponse>("/api/items/duplicates", { method: "POST", body: JSON.parse(key) })
      .then((r) => !cancelled && setResult({ key, matches: r.matches }))
      .catch(() => !cancelled && setResult(null));
    return () => {
      cancelled = true;
    };
  }, [key, empty]);
  const matches = !empty && result?.key === key ? result.matches : [];
  if (!matches.length) return null;
  const byId = matches.filter((m) => m.reasons.some(isIdReason)).length;
  const byTitle = matches.length - byId;
  const items = (n: number) => (n === 1 ? "1 item has" : `${n} items have`);
  return (
    <div className={`dupes ${byId ? "err" : "warn"}`} role="region" aria-labelledby="dupes-head">
      <div className="dupes-head">
        <b id="dupes-head">
          {byId
            ? `This ${noun} looks like it's already on Wikidata.`
            : matches.length === 1
              ? `${noun === "single" ? "A single" : "An album"} with this title is already on Wikidata.`
              : `${noun === "single" ? "Singles" : "Albums"} with this title are already on Wikidata.`}
        </b>
        <span>
          {byId
            ? `${items(byId)} the same identifier${byTitle ? ` and ${byTitle} more ${byTitle === 1 ? "has" : "have"} the same title` : ""}. Use one of these instead of creating a duplicate.`
            : `Check ${matches.length === 1 ? "it isn't" : "they aren't"} this one before creating a new ${noun}.`}
        </span>
      </div>
      <ul className="dupes-list">
        {matches.map((m, i) => {
          const id = m.reasons.some(isIdReason);
          const label = m.label ?? "(no label)";
          return (
            <li key={m.qid} className={id ? "dupe id" : "dupe"}>
              <span className="dupe-text">
                <span className="dupe-title">
                  <WikiLink base={wikiBaseUrl} qid={m.qid} />
                  <b>{label}</b>
                </span>
                {m.description && <span className="muted">{m.description}</span>}
                <ul className="pills" aria-label="Why it matched">
                  {m.reasons.map((r) => (
                    <li key={r} className={isIdReason(r) ? "pill bad" : "pill"}>
                      {capitalized(r)}
                    </li>
                  ))}
                </ul>
              </span>
              <button
                type="button"
                // Ranked strongest first, so an identifier match is always the first one.
                className={id && i === 0 ? undefined : "ghost"}
                aria-label={`Use ${label} (${m.qid})`}
                onClick={() =>
                  update((s) => {
                    s.album.mode = "existing";
                    s.album.qid = m.qid;
                    // It isn't a new album any more.
                    if (s.start === "new") s.start = "existing";
                  })
                }
              >
                Use this {noun}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="dupes-foot">
        None of these? Keep going and a new {noun} will be created.
      </span>
    </div>
  );
}

/**
 * A new album's artists as removable chips, then an input that adds one on
 * Enter (or when it loses focus, so a name typed in isn't lost).
 */
export function ArtistChips({
  state,
  update,
  error,
}: Pick<SectionProps, "state" | "update"> & { error?: string }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const names = state.album.artists
    .map((name, i) => ({ name: name.trim(), i }))
    .filter((a) => a.name);
  const add = () => {
    const name = draft.trim();
    setDraft("");
    if (!name) return;
    update((s) => {
      const kept = s.album.artists.map((a) => a.trim()).filter(Boolean);
      s.album.artists = kept.includes(name) ? kept : [...kept, name];
    });
  };
  return (
    <div className="f">
      <label htmlFor={id}>{capitalized(releaseNoun(state.album))} artists</label>
      <div
        className={`chips${error ? " invalid" : ""}`}
        onClick={(e) => e.target === e.currentTarget && inputRef.current?.focus()}
      >
        {names.length > 0 && (
          <ul aria-label={`${capitalized(releaseNoun(state.album))} artists`}>
            {names.map(({ name, i }) => (
              <li className="chip" key={`${i}-${name}`}>
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => {
                    update((s) => void s.album.artists.splice(i, 1));
                    inputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={draft}
          placeholder={names.length ? "Add another…" : "Add an artist…"}
          aria-invalid={!!error && !names.length}
          aria-describedby={`${id}-sub albumArtists-err`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
          onBlur={add}
        />
      </div>
      <span className="sub" id={`${id}-sub`}>
        Press Enter to add each one. Linked to Wikidata in People.
      </span>
      <FieldErr id="albumArtists" msg={error} />
    </div>
  );
}
