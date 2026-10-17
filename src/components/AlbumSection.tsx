import { useEffect, useRef, useState } from "react";
import { api } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import {
  albumArtists,
  ALBUM_CLASSES,
  ALBUM_FORMS,
  ALBUM_TYPES,
  QID,
  citesMb,
  loadedReleaseGroup,
  setAlbumType,
} from "../lib/plan.ts";
import { isIdReason } from "../lib/matches.ts";
import { ALBUM_ID_FIELDS, CLASS_KINDS, normalizeAlbumId } from "../lib/music.ts";
import type { DuplicateMatch, DuplicatesRequest, DuplicatesResponse } from "../lib/api-types.ts";
import { FieldErr, InfoTip, Pids, WikiLink } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import type { ItemLookup } from "./use-item-summaries.ts";
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
              <a
                className="album-card-link"
                href={`${wikiBaseUrl}/wiki/${qid}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on Wikidata ↗
              </a>
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
            <div className="msg summary row">
              <span>
                This album is on{" "}
                <a
                  href={`https://musicbrainz.org/release-group/${releaseGroup}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  MusicBrainz
                </a>
                . Load it from there to fill in the tracklist, performers and IDs.
              </span>
              <button
                type="button"
                className="small"
                onClick={() => onLoadReleaseGroup(releaseGroup, A.qid)}
              >
                Load from MusicBrainz
              </button>
            </div>
          )}
        </>
      ) : (
        <div>
          <div className="grid">
            <label className="f">
              Title
              <input
                type="text"
                value={A.title}
                aria-invalid={!!errs.albumTitle}
                onChange={(e) => update((s) => void (s.album.title = e.target.value))}
              />
              <span className="sub">
                <Pids>Label and P1476</Pids>
              </span>
              <FieldErr id="albumTitle" msg={errs.albumTitle} />
            </label>
            <AlbumArtists state={state} update={update} error={errs.albumArtists} />
            <label className="f">
              <Pids>Instance of (P31)</Pids>
              <select
                value={A.type}
                onChange={(e) => update((s) => setAlbumType(s, e.target.value))}
              >
                {ALBUM_TYPES.map(([q, l]) => (
                  <option key={q} value={q}>{`${l} (${q})`}</option>
                ))}
              </select>
            </label>
            <label className="f">
              <Pids>Form of creative work (P7937)</Pids>
              <select
                value={A.form}
                onChange={(e) => update((s) => void (s.album.form = e.target.value))}
              >
                <option value="">None</option>
                {ALBUM_FORMS.map(([q, l]) => (
                  <option key={q} value={q}>{`${l} (${q})`}</option>
                ))}
              </select>
            </label>
            <div className="f">
              <div className="f-head">
                <label htmlFor="albumDesc">Description template</label>
                <InfoTip id="albumDesc">
                  Write the description as plain text. Anything else in braces is an error.
                  <dl>
                    <dt>{"{year}"}</dt>
                    <dd>
                      Year of the publication date in Item settings. Needs a publication date.
                    </dd>
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
              <input
                id="albumDesc"
                type="text"
                value={state.settings.albumDesc}
                onChange={(e) => update((s) => void (s.settings.albumDesc = e.target.value))}
              />
              <FieldErr id="albumDesc" msg={errs.albumDesc} />
            </div>
            {ALBUM_ID_FIELDS.map((f) => (
              <label className="f" key={f.key}>
                <Pids>{`${f.label} (${f.property})`}</Pids>
                <input
                  type="text"
                  spellCheck={false}
                  value={A.ids[f.key]}
                  aria-invalid={!!errs[`albumId-${f.key}`]}
                  onChange={(e) =>
                    update(
                      (s) => void (s.album.ids[f.key] = normalizeAlbumId(f.key, e.target.value)),
                    )
                  }
                />
                <span className="sub">
                  Optional. ID or URL, checked for duplicates.
                  {citesMb(state, A.mb?.ids[f.key], A.ids[f.key].trim()) &&
                    " From MusicBrainz, so it gets a MusicBrainz reference while it stays the same."}
                </span>
                <FieldErr id={`albumId-${f.key}`} msg={errs[`albumId-${f.key}`]} />
              </label>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            <Pids>
              The album is created first with P31, P7937, P1476, P175, P577 (publication date),
              P407, the identifiers above, and P2635 number of tracks: one statement per disc
              qualified with its part when every disc has a part, otherwise one total.
            </Pids>
          </p>
          <Duplicates state={state} update={update} />
        </div>
      )}
    </section>
  );
}

/**
 * Why an existing album's QID can't be used, or null if it's fine or still
 * being looked up. The run checks this again before it starts.
 */
function albumProblem(qid: string, found: ItemLookup | undefined): string | null {
  if (found?.status === "missing") return `${qid} doesn't exist on Wikidata.`;
  if (found?.status === "redirect") return `${qid} redirects to ${found.to}. Use ${found.to}.`;
  if (found?.status !== "ok" || found.classes.some((c) => ALBUM_CLASSES.has(c))) return null;
  const name = found.label ? `${qid} (${found.label})` : qid;
  return found.classes.length === 0
    ? `${name} has no “instance of” statement, so it can't be checked to be an album or EP.`
    : `${name} isn't an album or EP. Check the QID.`;
}

/**
 * Albums in the mirror that share an identifier or the title with the one being
 * created. Once the album artists have QIDs, same-title albums by someone else
 * are left out.
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
  const byId = matches.some((m) => m.reasons.some(isIdReason));
  return (
    <div>
      <p className={`msg ${byId ? "err" : "warn"}`}>
        {byId
          ? "This album is already on Wikidata: an item has the same identifier."
          : "Albums with this title are already on Wikidata. Check they're not this one."}
      </p>
      <ul className="matches">
        {matches.map((m) => (
          <li key={m.qid}>
            <button
              type="button"
              className="ghost small"
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
            <WikiLink base={wikiBaseUrl} qid={m.qid} />
            <span>{m.label ?? "(no label)"}</span>
            <span className="muted">{m.description}</span>
            <span className="muted">({m.reasons.join(", ")})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A new album's artists, an input each. Focus goes to a row just added, or to
 * the row before one just removed.
 */
export function AlbumArtists({
  state,
  update,
  error,
}: Pick<SectionProps, "state" | "update"> & { error?: string }) {
  const rows = state.album.artists.length ? state.album.artists : [""];
  const listRef = useRef<HTMLDivElement>(null);
  const focusRow = useRef<number | null>(null);
  useEffect(() => {
    if (focusRow.current === null) return;
    listRef.current?.querySelectorAll("input")[focusRow.current]?.focus();
    focusRow.current = null;
  });
  return (
    <div className="f" ref={listRef}>
      <Pids>Album artists (P175)</Pids>
      {rows.map((name, i) => (
        <div className="artist-row" key={i}>
          <input
            type="text"
            value={name}
            aria-label={`Album artist ${i + 1}`}
            aria-invalid={!!error}
            onChange={(e) => update((s) => void (s.album.artists[i] = e.target.value))}
          />
          {rows.length > 1 && (
            <button
              type="button"
              className="ghost quiet small"
              aria-label={`Remove album artist ${i + 1}`}
              onClick={() => {
                focusRow.current = Math.max(0, i - 1);
                update((s) => void s.album.artists.splice(i, 1));
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="link add-artist"
        onClick={() => {
          focusRow.current = rows.length;
          update((s) => {
            // The one input shown for an empty list stands for its first row.
            if (!s.album.artists.length) s.album.artists.push("");
            s.album.artists.push("");
          });
        }}
      >
        Add an artist
      </button>
      <span className="sub">One name per artist, mapped in Performers</span>
      <FieldErr id="albumArtists" msg={error} />
    </div>
  );
}
