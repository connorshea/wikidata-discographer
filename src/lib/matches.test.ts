import { describe, expect, it } from "vite-plus/test";
import type { Match, RowMatches, TrackMatch } from "./api-types.ts";
import {
  candidateId,
  fillUnambiguous,
  isStrong,
  NO_ARTIST,
  openMatches,
  otherArtists,
  pickSingle,
  pickTrack,
  reviewTracks,
  stillValid,
  withoutDismissed,
} from "./matches.ts";
import type { Row } from "./plan.ts";
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

describe("fillUnambiguous with guesses", () => {
  it("doesn't fill a match that is only a same-title item with no artist", () => {
    const guess = <M extends Match>(m: M): M => ({ ...m, reasons: ["same title", NO_ARTIST] });
    const disc = emptyDisc();
    disc.single[1] = { date: "", qid: "" };
    const rows = {
      "0:1": rm({
        track: [guess(track("Q10", null))],
        comp: [guess(match("Q20"))],
        single: [guess(match("Q30"))],
      }),
      // Linked to a credited track, it's no longer a guess.
      "0:2": rm({
        comp: [{ ...match("Q21"), reasons: ["same title", NO_ARTIST, "recorded as Q11"] }],
      }),
    };
    expect(fillUnambiguous(disc, 0, rows)).toBe(1);
    expect(disc.track).toEqual({});
    expect(disc.comp).toEqual({ 2: "Q21" });
    expect(disc.single[1].qid).toBe("");
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

describe("isStrong", () => {
  it("is false for a same-title item with nothing else in common", () => {
    expect(isStrong({ ...match("Q1"), reasons: ["same title"] })).toBe(false);
    expect(isStrong({ ...match("Q1"), reasons: ["same title", NO_ARTIST] })).toBe(false);
    expect(isStrong({ ...match("Q1"), reasons: ["same title", "same performer"] })).toBe(true);
    expect(isStrong({ ...match("Q1"), reasons: ["recorded as Q2"] })).toBe(true);
  });
});

describe("otherArtists", () => {
  it("names the artists after “by” that aren't the track's", () => {
    expect(otherArtists("2022 single by the Black Keys", ["Carly Rae Jepsen"])).toEqual([
      "the Black Keys",
    ]);
    expect(otherArtists("1985 single by W.A.S.P band", ["Carly Rae Jepsen"])).toEqual(["W.A.S.P"]);
    expect(otherArtists("17th November 2015 Song By Naeto-C", [])).toEqual(["Naeto-C"]);
  });
  it("leaves out the track's own artists, loosely", () => {
    expect(otherArtists("song by Carly Rae Jepsen", ["Carly Rae Jepsen"])).toEqual([]);
    expect(
      otherArtists("song by Carly Rae Jepsen and Owl City from the album Kiss", [
        "Carly Rae Jepsen",
      ]),
    ).toEqual(["Owl City"]);
    expect(otherArtists("song by The Beatles", ["Beatles"])).toEqual([]);
    expect(otherArtists("song by Earth, Wind & Fire", ["Earth, Wind & Fire"])).toEqual([]);
  });
  it("is empty without a “by”", () => {
    expect(otherArtists("hymn tune", ["X"])).toEqual([]);
    expect(otherArtists(null, ["X"])).toEqual([]);
  });
});

describe("reviewTracks", () => {
  const row = (n: number, title = `T${n}`): Row => ({
    n,
    title,
    artists: ["A"],
    seconds: 0,
    raw: "",
  });
  const rows = {
    "0:1": rm({ comp: [match("Q1"), match("Q2")], single: [match("Q3")] }),
    "0:2": rm({ comp: [{ ...match("Q4"), description: "song by B" }] }),
  };
  const parsed = [[row(1), row(2), { error: "bad", raw: "x" }]];

  it("lists each track's candidates, open until one is used", () => {
    const disc = emptyDisc();
    const [t1, t2] = reviewTracks([disc], parsed, rows, new Set());
    expect(t1.candidates.map((c) => c.id)).toEqual(["0:1:comp:Q1", "0:1:comp:Q2", "0:1:single:Q3"]);
    expect(t1.reviewed).toBe(false);
    expect(t2.candidates[0].others).toEqual(["B"]);
    disc.comp[1] = "Q2";
    const [used] = reviewTracks([disc], parsed, rows, new Set());
    expect(used.reviewed).toBe(true);
    expect(used.candidates.map((c) => [c.used, c.taken])).toEqual([
      [false, true],
      [true, false],
      [false, false],
    ]);
  });

  it("counts a track reviewed once every candidate is dismissed or its field filled", () => {
    const disc = emptyDisc();
    const dismissed = new Set([candidateId(0, 1, "comp", "Q1"), candidateId(0, 1, "comp", "Q2")]);
    const [t1] = reviewTracks([disc], parsed, rows, dismissed);
    expect([t1.candidates.length, t1.dismissed, t1.reviewed]).toEqual([1, 2, false]);
    disc.single[1] = { date: "", qid: "Q9" };
    expect(reviewTracks([disc], parsed, rows, dismissed)[0].reviewed).toBe(true);
    dismissed.add(candidateId(0, 2, "comp", "Q4"));
    expect(reviewTracks([emptyDisc()], parsed, rows, dismissed)[1]).toMatchObject({
      candidates: [],
      dismissed: 1,
      reviewed: true,
    });
  });

  it("drops dismissed candidates from the matches", () => {
    const left = withoutDismissed(rows, new Set([candidateId(0, 1, "comp", "Q1")]));
    expect(left["0:1"].comp).toEqual([match("Q2")]);
    expect(left["0:2"]).toEqual(rows["0:2"]);
  });
});
