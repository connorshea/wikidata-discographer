import { emptyDisc } from "../lib/state.ts";
import { isCustomPart, normalizeQid, PARTS, QID, type Row } from "../lib/plan.ts";
import { QidInput } from "./common.tsx";
import type { SectionProps } from "./types.ts";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function DiscsSection({ state, update, plan }: SectionProps) {
  return (
    <section className="block">
      <h2>Discs</h2>
      <p className="hint">
        One tracklist per disc or side, a line per track: <code>1. Title - Artist (3:45)</code>.
        Fill in a composition or track QID to reuse an existing item instead of creating one.
      </p>
      {state.discs.map((_, di) => (
        <DiscBlock key={di} di={di} rows={plan.parsed[di] ?? []} {...{ state, update, plan }} />
      ))}
      <button
        type="button"
        className="ghost"
        onClick={() => update((s) => void s.discs.push(emptyDisc()))}
      >
        Add disc
      </button>
    </section>
  );
}

function DiscBlock({ di, rows, state, update, plan }: SectionProps & { di: number; rows: Row[] }) {
  const d = state.discs[di];
  const custom = isCustomPart(d);
  const setDisc = (fn: (disc: (typeof state.discs)[number]) => void) =>
    update((s) => fn(s.discs[di]));
  return (
    <div className={`disc ${di % 2 ? "night" : "day"}`}>
      <div className="head">
        <h3>Disc {di + 1}</h3>
        {state.discs.length > 1 && (
          <button
            type="button"
            className="danger small"
            onClick={() => update((s) => void s.discs.splice(di, 1))}
          >
            Remove disc
          </button>
        )}
      </div>
      <div className="grid">
        <label className="f">
          Part (P518 on the tracklist) <span className="sub">Blank for a single-disc album</span>
          <select
            value={custom ? "other" : d.part}
            onChange={(e) =>
              setDisc((disc) => {
                disc.partCustom = e.target.value === "other";
                disc.part = e.target.value === "other" ? "" : e.target.value;
              })
            }
          >
            <option value="">None</option>
            {PARTS.map(([group, opts]) => (
              <optgroup key={group} label={group}>
                {opts.map(([q, l]) => (
                  <option key={q} value={q}>{`${l} (${q})`}</option>
                ))}
              </optgroup>
            ))}
            <option value="other">Other QID…</option>
          </select>
          {custom && (
            <input
              type="text"
              spellCheck={false}
              placeholder="Q…"
              aria-label={`Disc ${di + 1} part QID`}
              value={d.part}
              onChange={(e) => setDisc((disc) => void (disc.part = normalizeQid(e.target.value)))}
            />
          )}
        </label>
      </div>
      <label className="f" style={{ marginTop: 12 }}>
        Tracklist
        <textarea
          rows={8}
          spellCheck={false}
          value={d.text}
          onChange={(e) => setDisc((disc) => void (disc.text = e.target.value))}
        />
      </label>
      {rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Artists</th>
                <th>Length</th>
                <th>Existing composition</th>
                <th>Existing track</th>
                <th>Single</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                r.error !== undefined ? (
                  <tr key={i}>
                    <td className="err" colSpan={7}>
                      {r.error}: <code>{r.raw}</code>
                    </td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td className="num">{r.n}</td>
                    <td>{r.title}</td>
                    <td>{r.artists.join(", ")}</td>
                    <td className="num">{fmt(r.seconds)}</td>
                    {(["comp", "track"] as const).map((k) => {
                      const v = (d[k][r.n] ?? "").trim();
                      return (
                        <td key={k}>
                          <QidInput
                            placeholder="Q…"
                            aria-label={`Track ${r.n} existing ${k === "comp" ? "composition" : "track"}`}
                            aria-invalid={v !== "" && !QID.test(v)}
                            value={d[k][r.n] ?? ""}
                            onChange={(q) =>
                              setDisc((disc) => {
                                if (q.trim()) disc[k][r.n] = q.trim();
                                else delete disc[k][r.n];
                              })
                            }
                          />
                        </td>
                      );
                    })}
                    <td>
                      <SingleCell di={di} n={r.n} {...{ state, update, plan }} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SingleCell({ di, n, state, update, plan }: SectionProps & { di: number; n: number }) {
  const sg = state.discs[di].single[n];
  const err = plan.singleErrs[`${di}:${n}`];
  if (!sg)
    return (
      <button
        type="button"
        className="ghost small"
        onClick={() => update((s) => void (s.discs[di].single[n] = { date: "", qid: "" }))}
      >
        Add single
      </button>
    );
  return (
    <div className="single">
      <input
        type="text"
        spellCheck={false}
        placeholder="Release date"
        aria-label={`Track ${n} single release date`}
        value={sg.date}
        onChange={(e) => update((s) => void (s.discs[di].single[n].date = e.target.value))}
      />
      <QidInput
        placeholder="or existing Q…"
        aria-label={`Track ${n} existing single`}
        value={sg.qid}
        onChange={(q) => update((s) => void (s.discs[di].single[n].qid = q.trim()))}
      />
      <button
        type="button"
        className="danger small"
        aria-label={`Remove single for track ${n}`}
        onClick={() => update((s) => void delete s.discs[di].single[n])}
      >
        ×
      </button>
      {err && <p className="field-err">{err}</p>}
    </div>
  );
}
