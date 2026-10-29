import { useState } from "react";
import {
  citesMbDate,
  descPreviews,
  isCustomLabelLang,
  isCustomLang,
  knownRecTypes,
  LABEL_LANGS,
  LANGS,
  NO_LINGUISTIC_CONTENT,
  normalizeDate,
  normalizeQid,
  REC_TYPES,
  releaseNoun,
  type Settings,
  TRACK_TYPES,
} from "../lib/plan.ts";
import { SETTING_FLAGS, settingsPills } from "../lib/progress.ts";
import { FieldErr, Lock, QidInput } from "./common.tsx";
import type { SectionProps } from "./types.ts";

type TextKey = "compDesc" | "trackDesc";
type FlagKey = (typeof SETTING_FLAGS)[number];

/** The options, grouped, each with a title and a line on what it does. */
const OPTION_GROUPS: [string, [FlagKey, string, string][]][] = [
  [
    "Statements",
    [
      [
        "compPerformer",
        "Performer on compositions",
        "Add performer to compositions as well as tracks",
      ],
    ],
  ],
  ["Text", [["straight", "Straight quotes", "Convert curly apostrophes and quotes"]]],
  [
    "MusicBrainz import",
    [
      [
        "mbWriters",
        "Composers and lyricists",
        "Add each work's composers and lyricists to new compositions",
      ],
    ],
  ],
];

export default function SettingsSection({
  state,
  update,
  plan,
  startCollapsed,
}: SectionProps & {
  /** Start as a summary, for a form a starting point already filled in. */
  startCollapsed: boolean;
}) {
  const S = state.settings;
  const errs = plan.fieldErrs;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    update((s) => void (s.settings[k] = v));
  const [open, setOpen] = useState(!startCollapsed);
  // Settings that block the run stay open, so their errors show.
  const blocked = plan.blockers.includes("settings");
  const shown = open || blocked;

  const labelLang = isCustomLabelLang(S) ? "other" : S.lang.trim() || "en";
  const workLang = isCustomLang(S) ? "other" : S.p407.trim();
  const previews = descPreviews(state, plan);
  const places = Object.entries(state.places);

  const template = (k: TextKey, kind: string, edge: string, preview: string | null) => (
    <div className="desc-row">
      <span className="desc-kind">
        <i className="sw" style={{ background: `var(--${edge})` }} />
        {kind}
      </span>
      <div className="f">
        <label htmlFor={k} className="visually-hidden">
          {`${kind.replace(/s$/, "")} description template`}
        </label>
        <input
          id={k}
          type="text"
          className="mono"
          spellCheck={false}
          value={S[k]}
          aria-invalid={errs[k] ? true : undefined}
          aria-describedby={`${k}-err ${k}-preview`}
          onChange={(e) => set(k, e.target.value)}
        />
        <FieldErr id={k} msg={errs[k]} />
      </div>
      <span className="desc-preview" id={`${k}-preview`}>
        <span className="visually-hidden">Preview: </span>
        {preview ?? "Fills in from the first track's artists"}
      </span>
    </div>
  );

  const header = (
    <div className="settings-head">
      <div>
        <h2>Item settings</h2>
        <p className="hint">Applied to each item the run creates.</p>
      </div>
      {!blocked && (
        <button
          type="button"
          className="ghost"
          aria-expanded={shown}
          aria-controls={shown ? "settings-body" : undefined}
          onClick={() => setOpen(!shown)}
        >
          {shown ? "Hide settings" : "Show all settings"}
        </button>
      )}
    </div>
  );

  if (!shown)
    return (
      <section className="block" id="settings">
        {header}
        <ul className="pills" aria-label="Current settings">
          {settingsPills(S).map((p) => (
            <li key={p} className="pill">
              {p}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <section className="block" id="settings">
      {header}
      <Lock>
        <div className="settings-body" id="settings-body">
          <div className="grid">
            <div className="f">
              <label htmlFor="langSel">Label language</label>
              <select
                id="langSel"
                value={labelLang}
                onChange={(e) =>
                  update((s) => {
                    const v = e.target.value;
                    s.settings.langCustom = v === "other";
                    s.settings.lang = v === "other" ? "" : v;
                  })
                }
              >
                {LABEL_LANGS.map(([c, l]) => (
                  <option key={c} value={c}>{`${l} (${c})`}</option>
                ))}
                <option value="other">Other code…</option>
              </select>
              {labelLang === "other" && (
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="e.g. pt-br"
                  aria-label="Other label language code"
                  value={S.lang}
                  onChange={(e) => set("lang", e.target.value.toLowerCase().trim())}
                />
              )}
              <span className="sub">Also used for the title</span>
              <FieldErr id="lang" msg={errs.lang} />
            </div>
            <label className="f">
              Publication date
              <input
                type="text"
                className="mono"
                spellCheck={false}
                value={S.date}
                onChange={(e) => set("date", e.target.value)}
                onBlur={(e) => set("date", normalizeDate(e.target.value))}
              />
              {citesMbDate(state) ? (
                <span className="sub with-badge">
                  <span
                    className="mb-badge"
                    title="Gets a MusicBrainz reference while it stays the same"
                  >
                    MB
                  </span>
                  Release date, from MusicBrainz
                </span>
              ) : (
                <span className="sub">
                  Release date. YYYY, YYYY-MM or YYYY-MM-DD (“June 12, 2012” is converted), blank to
                  skip
                </span>
              )}
              <FieldErr id="date" msg={errs.date} />
            </label>
            <label className="f">
              Recording date
              <input
                type="text"
                className="mono"
                spellCheck={false}
                placeholder="YYYY, YYYY-MM or YYYY-MM-DD"
                value={S.recDate}
                aria-invalid={errs.recDate ? true : undefined}
                onChange={(e) => set("recDate", e.target.value)}
                onBlur={(e) => set("recDate", normalizeDate(e.target.value))}
              />
              <span className="sub">
                Optional. Used for tracks with no date of their own or from MusicBrainz
              </span>
              <FieldErr id="recDate" msg={errs.recDate} />
            </label>
            <label className="f">
              Recorded at
              <QidInput
                className="mono"
                placeholder="Q…"
                value={S.recAt}
                aria-invalid={errs.recAt ? true : undefined}
                onChange={(v) => set("recAt", v)}
              />
              <span className="sub">
                Optional. The studio or venue of tracks with none of their own or from MusicBrainz
              </span>
              <FieldErr id="recAt" msg={errs.recAt} />
            </label>
            <div className="f">
              <label htmlFor="p407Sel">Language of work</label>
              <select
                id="p407Sel"
                value={workLang}
                onChange={(e) =>
                  update((s) => {
                    const v = e.target.value;
                    s.settings.p407Custom = v === "other";
                    s.settings.p407 = v === "other" ? "" : v;
                  })
                }
              >
                <option value="">None</option>
                <optgroup label="Instrumental">
                  <option
                    value={NO_LINGUISTIC_CONTENT}
                  >{`no linguistic content (${NO_LINGUISTIC_CONTENT})`}</option>
                </optgroup>
                <optgroup label="Languages">
                  {LANGS.map(([q, l]) => (
                    <option key={q} value={q}>{`${l} (${q})`}</option>
                  ))}
                </optgroup>
                <option value="other">Other QID…</option>
              </select>
              {workLang === "other" && (
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="Q…"
                  aria-label="Other language QID"
                  value={S.p407}
                  onChange={(e) => set("p407", normalizeQid(e.target.value))}
                />
              )}
              <span className="sub">
                {state.album.mode === "create"
                  ? `Added to the new ${releaseNoun(state.album)} and compositions.`
                  : "Added to new compositions."}
              </span>
              <FieldErr id="p407" msg={errs.p407} />
            </div>
          </div>

          {places.length > 0 && (
            <div className="places">
              <h3 className="kicker">Places on MusicBrainz</h3>
              <p className="desc-vars">Where MusicBrainz says the tracks were recorded.</p>
              <div className="grid">
                {places.map(([id, p]) => (
                  <label key={id} className="f">
                    {p.name}
                    <QidInput
                      className="mono"
                      placeholder="Q…"
                      value={p.qid}
                      aria-invalid={errs[`place-${id}`] ? true : undefined}
                      onChange={(v) => update((s) => void (s.places[id].qid = v))}
                    />
                    <span className="sub">
                      {p.qid.trim() ? (
                        <a
                          href={`https://musicbrainz.org/place/${id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          On MusicBrainz ↗
                        </a>
                      ) : (
                        <>
                          No Wikidata link on{" "}
                          <a
                            href={`https://musicbrainz.org/place/${id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            MusicBrainz ↗
                          </a>
                          . Enter its QID, or its tracks won't say where they were recorded.
                        </>
                      )}
                    </span>
                    <FieldErr id={`place-${id}`} msg={errs[`place-${id}`]} />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="descs">
            <h3 className="kicker">Descriptions</h3>
            <p className="desc-vars">
              Variables: <code>{"{year}"}</code> <code>{"{artists}"}</code>
            </p>
            {template("compDesc", "Compositions", "cmp-edge", previews?.comp ?? null)}
            {template("trackDesc", "Tracks", "trk-edge", previews?.track ?? null)}
          </div>

          <label className="f track-type">
            Tracks are an instance of
            <select value={S.trackType} onChange={(e) => set("trackType", e.target.value)}>
              {TRACK_TYPES.map(([q, l]) => (
                <option key={q} value={q}>{`${l} (${q})`}</option>
              ))}
            </select>
            <span className="sub">The default for every track.</span>
          </label>

          <div className="f" role="group" aria-labelledby="recTypes-label">
            <span id="recTypes-label">Recording type (has characteristic)</span>
            <div className="rt-chips">
              {REC_TYPES.map(([q, l]) => (
                <button
                  key={q}
                  type="button"
                  className="rt-chip"
                  aria-pressed={S.recTypes.includes(q)}
                  onClick={() =>
                    set(
                      "recTypes",
                      S.recTypes.includes(q)
                        ? S.recTypes.filter((x) => x !== q)
                        : knownRecTypes([...S.recTypes, q]),
                    )
                  }
                >
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
            <span className="sub">
              The default for every track. A MusicBrainz import will sometimes fill this in for you.
            </span>
          </div>

          <div className="option-groups">
            {OPTION_GROUPS.map(([group, opts]) => (
              <fieldset key={group}>
                <legend className="kicker">{group}</legend>
                {opts.map(([k, title, about]) => (
                  <label className="opt" key={k}>
                    <input
                      type="checkbox"
                      checked={S[k]}
                      onChange={(e) => set(k, e.target.checked)}
                    />
                    <span>
                      <b>{title}</b>
                      <span>{about}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </div>
      </Lock>
    </section>
  );
}
