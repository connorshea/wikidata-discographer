import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { useAuth } from "../lib/auth-context.ts";
import { ALBUM_FORMS, ALBUM_TYPES, QID, splitArtists } from "../lib/plan.ts";
import { isIdReason } from "../lib/matches.ts";
import { ALBUM_ID_FIELDS, normalizeAlbumId } from "../lib/music.ts";
import type { DuplicateMatch, DuplicatesRequest, DuplicatesResponse } from "../lib/api-types.ts";
import { FieldErr, InfoTip, QidInput, WikiLink } from "./common.tsx";
import { useDebounced } from "./use-debounced.ts";
import type { SectionProps } from "./types.ts";

export default function AlbumSection({ state, update, plan }: SectionProps) {
  const A = state.album;
  const errs = plan.fieldErrs;
  return (
    <section className="block">
      <h2>Album</h2>
      <p className="hint">
        All discs belong to this one album. Its tracklist (P658) is added after the tracks are
        created, and singles point to it with P13602.
      </p>
      <div className="row" role="radiogroup" aria-label="Album">
        {(["existing", "create"] as const).map((mode) => (
          <label className="c" key={mode}>
            <input
              type="radio"
              name="albumMode"
              checked={A.mode === mode}
              onChange={() => update((s) => void (s.album.mode = mode))}
            />{" "}
            {mode === "existing" ? "Use an existing album" : "Create a new album"}
          </label>
        ))}
      </div>
      {A.mode === "existing" ? (
        <div className="grid" style={{ marginTop: 12 }}>
          <label className="f">
            Album QID
            <QidInput
              id="albumQid"
              placeholder="Q…"
              value={A.qid}
              aria-invalid={!!errs.albumQid}
              onChange={(v) => update((s) => void (s.album.qid = v.trim()))}
            />
            <span className="sub">Q-number or Wikidata URL</span>
            <FieldErr id="albumQid" msg={errs.albumQid} />
          </label>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="grid">
            <label className="f">
              Title
              <input
                type="text"
                value={A.title}
                aria-invalid={!!errs.albumTitle}
                onChange={(e) => update((s) => void (s.album.title = e.target.value))}
              />
              <span className="sub">Label and P1476</span>
              <FieldErr id="albumTitle" msg={errs.albumTitle} />
            </label>
            <label className="f">
              Album artists (P175)
              <input
                type="text"
                value={A.artists}
                aria-invalid={!!errs.albumArtists}
                onChange={(e) => update((s) => void (s.album.artists = e.target.value))}
              />
              <span className="sub">
                Names as you'd write them in the tracklist, mapped in Performers
              </span>
              <FieldErr id="albumArtists" msg={errs.albumArtists} />
            </label>
            <label className="f">
              Instance of (P31)
              <select
                value={A.type}
                onChange={(e) => update((s) => void (s.album.type = e.target.value))}
              >
                {ALBUM_TYPES.map(([q, l]) => (
                  <option key={q} value={q}>{`${l} (${q})`}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Form of creative work (P7937)
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
                    <dd>The form, e.g. “studio album”, or “album” or “EP” when there's no form.</dd>
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
                {f.label} ({f.property})
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
                <span className="sub">Optional. ID or URL, checked for duplicates</span>
                <FieldErr id={`albumId-${f.key}`} msg={errs[`albumId-${f.key}`]} />
              </label>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            The album is created first with P31, P7937, P1476, P175, P577 (publication date), P407,
            the identifiers above, and P2635 number of tracks: one statement per disc qualified with
            its part when every disc has a part, otherwise one total.
          </p>
          <Duplicates state={state} update={update} />
        </div>
      )}
    </section>
  );
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
      performers: splitArtists(A.artists, state.settings.splitArtists)
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
