import { describe, expect, it } from "vite-plus/test";
import type { Match, RowMatches, TrackMatch } from "./api-types.ts";
import { fillUnambiguous, openMatches, pickSingle, pickTrack, stillValid } from "./matches.ts";
import { emptyDisc } from "./state.ts";

const match = (qid: string): Match => ({
  qid,
  kind: "work",
  label: null,
  description: null,
  reasons: [],
});
const track = (qid: string, composition: string | null, singles: string[] = []): TrackMatch => ({
  ...match(qid),
  kind: "track",
  composition,
  singles,
});
const rm = (m: Partial<RowMatches>): RowMatches => ({ comp: [], track: [], single: [], ...m });

describe("pickTrack and pickSingle", () => {
  it("fills the track's composition, and its single where empty", () => {
    const disc = emptyDisc();
    disc.single[1] = { date: "2026", qid: "" };
    pickTrack(disc, 1, track("Q10", "Q20", ["Q30"]));
    expect([disc.track[1], disc.comp[1], disc.single[1]]).toEqual([
      "Q10",
      "Q20",
      { date: "2026", qid: "Q30" },
    ]);
    // The track's own composition replaces another, which would be a second P2550.
    disc.comp[2] = "Q99";
    pickTrack(disc, 2, track("Q11", "Q21"));
    expect(disc.comp[2]).toBe("Q21");
    // A track that records none keeps the composition filled in.
    disc.comp[4] = "Q98";
    pickTrack(disc, 4, track("Q14", null));
    expect(disc.comp[4]).toBe("Q98");
    pickSingle(disc, 3, "Q31");
    expect(disc.single[3]).toEqual({ date: "", qid: "Q31" });
  });
});

describe("openMatches", () => {
  it("drops matches for fields already filled", () => {
    const disc = emptyDisc();
    disc.track[1] = "Q10";
    const m = rm({ track: [track("Q10", null)], comp: [match("Q20")] });
    expect(openMatches(disc, 1, m)).toEqual(rm({ comp: [match("Q20")] }));
    disc.comp[1] = "Q20";
    expect(openMatches(disc, 1, m)).toBeNull();
  });
});

describe("fillUnambiguous", () => {
  it("fills single matches on this disc, and leaves ambiguous ones", () => {
    const disc = emptyDisc();
    disc.single[1] = { date: "", qid: "" };
    const rows = {
      // A track with its composition: the other composition candidate doesn't matter.
      "0:1": rm({ track: [track("Q10", "Q20", ["Q30"])], comp: [match("Q20"), match("Q21")] }),
      // Two tracks: only the composition is certain.
      "0:2": rm({ track: [track("Q11", null), track("Q12", null)], comp: [match("Q22")] }),
      // A single for a track not marked as having one isn't added.
      "0:3": rm({ single: [match("Q33")] }),
      "1:1": rm({ comp: [match("Q99")] }),
    };
    expect(fillUnambiguous(disc, 0, rows)).toBe(4);
    expect(disc.track).toEqual({ 1: "Q10" });
    expect(disc.comp).toEqual({ 1: "Q20", 2: "Q22" });
    expect(disc.single).toEqual({ 1: { date: "", qid: "Q30" } });
    expect(fillUnambiguous(disc, 0, rows)).toBe(0);
  });

  it("never fills a track and composition that disagree", () => {
    const disc = emptyDisc();
    disc.comp[1] = "Q99"; // differs from the only track's composition
    disc.track[2] = "Q50"; // entered by hand: its composition is unknown
    disc.track[3] = "Q13"; // a matched track that records none
    const rows = {
      "0:1": rm({ track: [track("Q10", "Q20")] }),
      "0:2": rm({ comp: [match("Q22")] }),
      "0:3": rm({ track: [track("Q13", null)], comp: [match("Q23")] }),
    };
    expect(fillUnambiguous(disc, 0, rows)).toBe(1);
    expect(disc.track).toEqual({ 2: "Q50", 3: "Q13" });
    expect(disc.comp).toEqual({ 1: "Q99", 3: "Q23" });
  });
});

describe("stillValid", () => {
  const row = (key: string, title: string, performers = ["Q1"]) => ({ key, title, performers });
  const answered = {
    request: { albumQid: "", rows: [row("0:1", "A"), row("0:2", "B"), row("0:3", "C")] },
    rows: { "0:1": rm({ comp: [match("Q10")] }), "0:2": rm({ comp: [match("Q20")] }) },
  };

  it("keeps the matches of unchanged rows, and drops edited ones", () => {
    const request = {
      albumQid: "",
      rows: [row("0:1", "A"), row("0:2", "B2"), row("0:3", "C"), row("0:4", "D")],
    };
    expect(stillValid(answered, request)).toEqual({ "0:1": answered.rows["0:1"] });
    const performers = { albumQid: "", rows: [row("0:1", "A", ["Q1", "Q2"]), row("0:2", "B")] };
    expect(stillValid(answered, performers)).toEqual({ "0:2": answered.rows["0:2"] });
  });

  it("drops everything when the album changes, or before any answer", () => {
    expect(stillValid(answered, { ...answered.request, albumQid: "Q5" })).toEqual({});
    expect(stillValid(null, answered.request)).toEqual({});
  });
});
