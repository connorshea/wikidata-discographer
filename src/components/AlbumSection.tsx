import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import {
  albumArtists,
  albumDescPreview,
  ALBUM_FORMS,
  ALBUM_TYPES,
  QID,
  citesMb,
  EP_CLASS,
  loadedReleaseGroup,
  setAlbumType,
} from "../lib/plan.ts";
import { isIdReason } from "../lib/matches.ts";
import { ALBUM_ID_FIELDS, type AlbumIdKey, CLASS_KINDS, normalizeAlbumId } from "../lib/music.ts";
import type { DuplicateMatch, DuplicatesRequest, DuplicatesResponse } from "../lib/api-types.ts";
import { FieldErr, InfoTip, Pids, WikiLink } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import { albumProblem, type ItemLookup } from "./use-item-summaries.ts";
import type { SectionProps } from "./types.ts";
import type { AlbumTracklist } from "./use-album-tracklist.ts";

/** The album's kind, from its classes on Wikidata: "EP" or "Album". */
const kindOf = (classes: string[]) =>
  classes.some((c) => CLASS_KINDS.some(([q, k]) => q === c && k === "ep")) ? "EP" : "Album";

export default function AlbumSection({
  state,
  update,
  plan,
  found,
  albumTracklist,
  checked,
  releaseGroup,
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
  return (
    <section className="block" id="album">
      <div className="album-head">
        <h2>
          <span className="sw" style={{ background: "var(--disc-edge)" }} aria-hidden="true" />
          Album
        </h2>
        <span className="sub">
          {A.mode === "create"
            ? "New album"
            : state.start === "mb"
              ? "Found on Wikidata through the MusicBrainz release group"
              : "Existing album"}
        </span>
      </div>
      {A.mode === "existing" ? (
        <>
          <div className={`album-card${problem || albumTracklist ? " bad" : ""}`}>
            <div className="album-card-text">
              <div className="album-card-title">
                {qid && <span className="qid-chip mono">{qid}</span>}
                <b>{ok?.label ?? (found?.status === "loading" ? "Loading…" : "")}</b>
              </div>
              {ok?.description && <div className="muted">{ok.description}</div>}
              {ok && !notAlbum && (
                <ul className="pills" aria-label="About this album">
                  <li className="pill">{kindOf(ok.classes)}</li>
                  {checked && !albumTracklist && <li className="pill ok">No tracklist yet</li>}
                </ul>
              )}
            </div>
            {QID.test(qid) && (
              <div className="album-card-actions">
                <button
                  type="button"
                  className="link album-card-link"
                  disabled={reloading}
                  onClick={onReload}
                >
                  {reloading ? "Reloading…" : "Reload from Wikidata"}
                </button>
                <a
                  className="album-card-link"
                  href={`${wikiBaseUrl}/wiki/${qid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on Wikidata ↗
                </a>
              </div>
            )}
          </div>
          {(problem || albumTracklist) && (
            <p className="album-err" id="albumQid-err">
              <span>
                {albumTracklist
                  ? `This album already has a tracklist with ${albumTracklist.tracks.length} track${albumTracklist.tracks.length === 1 ? "" : "s"}. Adding another would list its songs twice, so it can't be used.`
                  : problem}{" "}
                <button type="button" className="link" onClick={onPickAnother}>
                  Pick a different album
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
                  This album is on{" "}
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
        </>
      ) : (
        <div className="album-new">
          <Duplicates state={state} update={update} />
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
                    says “EP” in place of “album”, e.g. “live EP”.
                  </dd>
                  <dt>{"{artists}"}</dt>
                  <dd>The album artists, joined like “A, B and C”.</dd>
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
              The album is created first with P31, P7937, P1476, P175, P577 (publication date),
              P407, the identifiers above, and P2635 number of tracks: one statement per disc
              qualified with its part when every disc has a part, otherwise one total.
            </Pids>
          </p>
        </div>
      )}
    </section>
  );
}

/** A new album's type, Album or EP. */
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
            {q === EP_CLASS ? "EP" : "Album"}
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

const sentence = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Albums in the mirror that share an identifier or the title with the one being
 * created, strongest first. Once the album artists have QIDs, same-title albums
 * by someone else are left out. Any identifier match makes it red, and the
 * first such album gets the primary button.
 */
function Duplicates({ state, update }: Omit<SectionProps, "plan">) {
  const { wikiBaseUrl } = useAuth();
  const A = state.album;
  // Debounce the serialized request: a fresh object every render would never settle.
  const key = useDebounced(
    JSON.stringify({
      title: A.title,
      kinds: ["album", "ep"],
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
            ? "This album looks like it's already on Wikidata."
            : matches.length === 1
              ? "An album with this title is already on Wikidata."
              : "Albums with this title are already on Wikidata."}
        </b>
        <span>
          {byId
            ? `${items(byId)} the same identifier${byTitle ? ` and ${byTitle} more ${byTitle === 1 ? "has" : "have"} the same title` : ""}. Use one of these instead of creating a duplicate.`
            : `Check ${matches.length === 1 ? "it isn't" : "they aren't"} this one before creating a new album.`}
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
                      {sentence(r)}
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
                Use this album
              </button>
            </li>
          );
        })}
      </ul>
      <span className="dupes-foot">None of these? Keep going and a new album will be created.</span>
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
      <label htmlFor={id}>Album artists</label>
      <div
        className={`chips${error ? " invalid" : ""}`}
        onClick={(e) => e.target === e.currentTarget && inputRef.current?.focus()}
      >
        {names.length > 0 && (
          <ul aria-label="Album artists">
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
        Press Enter to add each one. Linked to Wikidata in Performers.
      </span>
      <FieldErr id="albumArtists" msg={error} />
    </div>
  );
}
