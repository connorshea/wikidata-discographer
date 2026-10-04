import {
  isCustomLabelLang,
  isCustomLang,
  LABEL_LANGS,
  LANGS,
  NO_LINGUISTIC_CONTENT,
  normalizeDate,
  normalizeQid,
  type Settings,
  TRACK_TYPES,
} from "../lib/plan.ts";
import { FieldErr, InfoTip, Pids } from "./common.tsx";
import type { SectionProps } from "./types.ts";

type TextKey = "compDesc" | "trackDesc" | "singleDesc";
type FlagKey = "compPerformer" | "duration" | "straight" | "splitArtists" | "extendExisting";

const FLAGS: [FlagKey, string][] = [
  ["compPerformer", "Add performer (P175) to compositions as well as tracks"],
  ["duration", "Add duration (P2047, in seconds) to tracks"],
  ["straight", "Convert curly apostrophes and quotes to straight ones"],
  ["splitArtists", "Split artists on “,” “&” “feat.” “ft.”"],
  ["extendExisting", "Add missing links to existing items you reuse (P2550, P175)"],
];

export default function SettingsSection({ state, update, plan }: SectionProps) {
  const S = state.settings;
  const errs = plan.fieldErrs;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    update((s) => void (s.settings[k] = v));

  const labelLang = isCustomLabelLang(S) ? "other" : S.lang.trim() || "en";
  const workLang = isCustomLang(S) ? "other" : S.p407.trim();

  const template = (k: TextKey, label: string, tip: string, yearNote: string) => (
    <div className="f">
      <div className="f-head">
        <label htmlFor={k}>{label}</label>
        <InfoTip id={k}>
          {tip}
          <dl>
            <dt>{"{year}"}</dt>
            <dd>{yearNote}</dd>
            <dt>{"{artists}"}</dt>
            <dd>Artist names as written in the tracklist, joined like “A, B and C”.</dd>
          </dl>
        </InfoTip>
      </div>
      <input id={k} type="text" value={S[k]} onChange={(e) => set(k, e.target.value)} />
      <FieldErr id={k} msg={errs[k]} />
    </div>
  );
  const perTrack =
    "Write the description as plain text. These variables are replaced for each track, and anything else in braces is an error.";
  const yearNote = "Year of the publication date above. Needs a publication date.";

  return (
    <section className="block">
      <h2>Item settings</h2>
      <p className="hint">Applied to newly created items.</p>
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
          <span className="sub">
            <Pids>Also used for the P1476 title</Pids>
          </span>
          <FieldErr id="lang" msg={errs.lang} />
        </div>
        <label className="f">
          <Pids>Publication date (P577)</Pids>
          <input
            type="text"
            spellCheck={false}
            value={S.date}
            onChange={(e) => set("date", e.target.value)}
            onBlur={(e) => set("date", normalizeDate(e.target.value))}
          />
          <span className="sub">
            Album release date, not added to compositions or tracks. YYYY, YYYY-MM or YYYY-MM-DD
            (“June 12, 2012” is converted), blank to skip
          </span>
          <FieldErr id="date" msg={errs.date} />
        </label>
        <div className="f">
          <label htmlFor="p407Sel">
            <Pids>Language of work (P407)</Pids>
          </label>
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
            <optgroup label="Languages">
              {LANGS.map(([q, l]) => (
                <option key={q} value={q}>{`${l} (${q})`}</option>
              ))}
            </optgroup>
            <optgroup label="Instrumental">
              <option
                value={NO_LINGUISTIC_CONTENT}
              >{`no linguistic content (${NO_LINGUISTIC_CONTENT})`}</option>
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
          <span className="sub">Added to a new album and compositions (not tracks or singles)</span>
          <FieldErr id="p407" msg={errs.p407} />
        </div>
      </div>

      <h3 className="sub">
        <i style={{ background: "var(--cmp-edge)" }} />
        Compositions
      </h3>
      <div className="grid">
        {template("compDesc", "Description template", perTrack, yearNote)}
        <div className="f">
          Statements{" "}
          <span className="sub">
            <Pids>
              P31 musical work/composition (Q105543609), P7937 song (Q7366), P1476, plus the options
              below
            </Pids>
          </span>
        </div>
      </div>

      <h3 className="sub">
        <i style={{ background: "var(--trk-edge)" }} />
        Tracks
      </h3>
      <div className="grid">
        {template("trackDesc", "Description template", perTrack, yearNote)}
        <label className="f">
          <Pids>Instance of (P31)</Pids>
          <select value={S.trackType} onChange={(e) => set("trackType", e.target.value)}>
            {TRACK_TYPES.map(([q, l]) => (
              <option key={q} value={q}>{`${l} (${q})`}</option>
            ))}
          </select>
        </label>
      </div>

      <h3 className="sub">
        <i style={{ background: "var(--rg-edge)" }} />
        Singles
      </h3>
      <p className="hint">
        <Pids>
          Tick "Single" on a track in the disc tables. Each single gets P31 single (Q134556), P1476,
          P175, its own P577 release date, a P658 tracklist pointing at the track, and P13602 single
          taken from the album.
        </Pids>
      </p>
      <div className="grid">
        {template(
          "singleDesc",
          "Description template",
          "Write the description as plain text. These variables are replaced for each single, and anything else in braces is an error.",
          "Year of that single's release date, entered in the disc table. Needs a release date.",
        )}
      </div>

      <div className="checks">
        {FLAGS.map(([k, label]) => (
          <label className="c" key={k}>
            <input type="checkbox" checked={S[k]} onChange={(e) => set(k, e.target.checked)} />{" "}
            <Pids>{label}</Pids>
          </label>
        ))}
      </div>
    </section>
  );
}
