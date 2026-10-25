import { describe, expect, it } from "vite-plus/test";
import type { Match, RowMatches, TrackMatch } from "./api-types.ts";
import {
  candidateId,
  comesWithTrack,
  dismissAllIds,
  isStrong,
  NO_ARTIST,
  otherArtists,
  pickTrack,
  moveRowIds,
  removedDisc,
  renumberedRows,
  reviewedLine,
  reviewSummary,
  reviewTracks,
  stillValid,
  summaryLine,
  takenLine,
  ties,
  withoutDismissed,
} from "./matches.ts";
import type { Track } from "./plan.ts";
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

describe("pickTrack", () => {
  it("fills the track's composition", () => {
    const disc = emptyDisc();
    pickTrack(disc, 1, track("Q10", "Q20", ["Q30"]));
    expect([disc.track[1], disc.comp[1]]).toEqual(["Q10", "Q20"]);
    // The track's own composition replaces another, which would be a second P2550.
    disc.comp[2] = "Q99";
    pickTrack(disc, 2, track("Q11", "Q21"));
    expect(disc.comp[2]).toBe("Q21");
    // A track that records none keeps the composition filled in.
    disc.comp[4] = "Q98";
    pickTrack(disc, 4, track("Q14", null));
    expect(disc.comp[4]).toBe("Q98");
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
    const live = { albumQid: "", rows: [{ ...row("0:1", "A"), recTypes: ["Q56123235"] }] };
    expect(stillValid(answered, live)).toEqual({});
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
    expect(isStrong({ ...match("Q1"), reasons: ["similar title"] })).toBe(false);
    expect(isStrong({ ...match("Q1"), reasons: ["similar title", "same performer"] })).toBe(true);
  });
});

describe("ties", () => {
  it("names what ties a match beyond its title, strongest first", () => {
    expect(ties({ reasons: ["same title", "same performer"] })).toEqual(["Same performer"]);
    expect(ties({ reasons: ["same title", "same performer", "on this album"] })).toEqual([
      "On this album",
      "Same performer",
    ]);
    expect(ties({ reasons: ["recorded as Q2", "similar title"] })).toEqual(["Recorded as Q2"]);
  });

  it("is empty for a title-only match", () => {
    expect(ties({ reasons: ["same title", NO_ARTIST] })).toEqual([]);
    expect(ties({ reasons: ["similar title"] })).toEqual([]);
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
    expect(otherArtists("song by Icona Pop featuring Charli XCX", ["Icona Pop"])).toEqual([
      "Charli XCX",
    ]);
    expect(otherArtists("song by Earth, Wind & Fire", ["Earth, Wind & Fire"])).toEqual([]);
  });
  it("names the artist a description starts with", () => {
    expect(otherArtists("Portugal The Man song", ["Carly Rae Jepsen"])).toEqual([
      "Portugal The Man",
    ]);
    expect(otherArtists("2011 Jay-Z and Kanye West single", ["Kanye West"])).toEqual(["Jay-Z"]);
    expect(otherArtists("Owl City track", ["X"])).toEqual(["Owl City"]);
    expect(otherArtists("Portugal The Man song", ["Portugal. The Man"])).toEqual([]);
  });
  it("doesn't take a description of the song for an artist", () => {
    expect(otherArtists("English folk song", ["X"])).toEqual([]);
    expect(otherArtists("Christmas song", ["X"])).toEqual([]);
    expect(otherArtists("2015 song", ["X"])).toEqual([]);
    expect(otherArtists("promotional single", ["X"])).toEqual([]);
  });
  it("leaves out who wrote it, but not who performed it", () => {
    expect(
      otherArtists("2008 original song written by Adam Young, and performed by Owl City", [
        "Owl City",
      ]),
    ).toEqual([]);
    expect(
      otherArtists(
        "original film song composed by Alan Menken, words by Howard Ashman; from the 1989 Disney animated film",
        ["X"],
      ),
    ).toEqual([]);
    expect(
      otherArtists(
        "original Christmas song written and composed by Irving Berlin for the 1942 musical film, sung by Bing Crosby",
        ["X"],
      ),
    ).toEqual(["Bing Crosby"]);
    expect(
      otherArtists("original song co-written and performed by Carly Rae Jepsen", ["Owl City"]),
    ).toEqual(["Carly Rae Jepsen"]);
  });
  it("is empty without a performer", () => {
    expect(otherArtists("hymn tune", ["X"])).toEqual([]);
    expect(otherArtists("song written by Irving Berlin", ["X"])).toEqual([]);
    expect(otherArtists(null, ["X"])).toEqual([]);
  });
});

describe("reviewTracks", () => {
  const row = (n: number, title = `T${n}`): Track => ({
    n,
    title,
    artists: ["A"],
    seconds: 0,
    mb: null,
  });
  const rows = {
    "0:1": rm({ comp: [match("Q1"), match("Q2")], single: [match("Q3")] }),
    "0:2": rm({ comp: [{ ...match("Q4"), description: "song by B" }] }),
  };
  const parsed = [[row(1), row(2)]];

  it("lists each track's candidates, open until every one is settled", () => {
    const disc = emptyDisc();
    const [t1, t2] = reviewTracks([disc], parsed, rows, new Set());
    // Singles aren't suggested for now.
    expect(t1.candidates.map((c) => c.id)).toEqual(["0:1:comp:Q1", "0:1:comp:Q2"]);
    expect(t1.reviewed).toBe(false);
    expect(t2.candidates[0].others).toEqual(["B"]);
    disc.comp[1] = "Q2";
    const [used] = reviewTracks([disc], parsed, rows, new Set());
    expect(used.candidates.map((c) => [c.used, c.taken])).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(used.reviewed).toBe(true);
    expect(takenLine(used)).toBe("1 other composition");
  });

  it("keeps a used track open until its own composition is used or dismissed", () => {
    const disc = emptyDisc();
    disc.track[1] = "Q50";
    const recorded = { "0:1": rm({ track: [track("Q50", "Q60")], comp: [match("Q60")] }) };
    expect(reviewTracks([disc], [[row(1)]], recorded, new Set())[0].reviewed).toBe(false);
    const dismissed = new Set([candidateId(0, 1, "comp", "Q60")]);
    expect(reviewTracks([disc], [[row(1)]], recorded, dismissed)[0].reviewed).toBe(true);
    disc.comp[1] = "Q60";
    expect(reviewTracks([disc], [[row(1)]], recorded, new Set())[0].reviewed).toBe(true);
  });

  it("counts a track reviewed once every candidate is dismissed or its field filled", () => {
    const disc = emptyDisc();
    const dismissed = new Set([candidateId(0, 1, "comp", "Q1")]);
    const [t1] = reviewTracks([disc], parsed, rows, dismissed);
    expect([t1.candidates.length, t1.dismissed, t1.reviewed]).toEqual([1, 1, false]);
    disc.comp[1] = "Q9";
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

  it("dismisses every candidate left but a used one with Dismiss all", () => {
    const disc = emptyDisc();
    const [t1] = reviewTracks([disc], parsed, rows, new Set());
    expect(dismissAllIds(t1)).toEqual(["0:1:comp:Q1", "0:1:comp:Q2"]);
    disc.comp[1] = "Q2";
    const dismissed = new Set(dismissAllIds(reviewTracks([disc], parsed, rows, new Set())[0]));
    expect([...dismissed]).toEqual(["0:1:comp:Q1"]);
    expect(reviewTracks([disc], parsed, rows, dismissed)[0]).toMatchObject({
      dismissed: 1,
      reviewed: true,
    });
  });

  it("sums up the review across tracks", () => {
    const disc = emptyDisc();
    disc.comp[1] = "Q1";
    const dismissed = new Set([candidateId(0, 1, "comp", "Q2"), candidateId(0, 2, "comp", "Q4")]);
    expect(reviewSummary(reviewTracks([disc], parsed, rows, dismissed))).toEqual({
      tracks: 2,
      reviewed: 2,
      reused: 1,
      dismissed: 2,
    });
    expect(reviewSummary([])).toEqual({ tracks: 0, reviewed: 0, reused: 0, dismissed: 0 });
  });
});

describe("reviewedLine and summaryLine", () => {
  const row: Track = { n: 1, title: "T1", artists: ["A"], seconds: 0, mb: null };
  const rows = {
    "0:1": rm({
      track: [track("Q50", "Q60", ["Q70"])],
      comp: [match("Q60")],
      single: [match("Q70")],
    }),
  };
  const review = (disc = emptyDisc(), dismissed = new Set<string>()) =>
    reviewTracks([disc], [[row]], rows, dismissed)[0];

  it("names the one item used, with its QID", () => {
    const disc = emptyDisc();
    disc.comp[1] = "Q60";
    const dismissed = new Set([candidateId(0, 1, "track", "Q50")]);
    expect(reviewedLine(review(disc, dismissed))).toBe("Using the composition, Q60, 1 dismissed");
  });

  it("names every kind used, the track first", () => {
    const disc = emptyDisc();
    pickTrack(disc, 1, rows["0:1"].track[0]);
    const r = review(disc);
    expect(reviewedLine(r)).toBe("Using the track and composition");
    expect(r.candidates.map((c) => comesWithTrack(r, c))).toEqual([true, false]);
  });

  it("says a track whose candidates were all dismissed is created new", () => {
    const all = new Set(dismissAllIds(review()));
    expect(reviewedLine(review(emptyDisc(), all))).toBe("2 dismissed, creating new");
  });

  it("says when other QIDs are filled in instead", () => {
    const disc = emptyDisc();
    disc.track[1] = "Q1";
    disc.comp[1] = "Q2";
    const dismissed = new Set([candidateId(0, 1, "comp", "Q60")]);
    expect(reviewedLine(review(disc, dismissed))).toBe("1 dismissed, other QIDs filled in");
    expect(reviewedLine(review(disc))).toBe("Other QIDs are filled in");
  });

  it("folds the whole review into a line", () => {
    expect(summaryLine({ tracks: 5, reviewed: 5, reused: 4, dismissed: 3 })).toBe(
      "Using 4 items, 3 dismissed",
    );
    expect(summaryLine({ tracks: 1, reviewed: 1, reused: 1, dismissed: 0 })).toBe("Using 1 item");
    expect(summaryLine({ tracks: 1, reviewed: 1, reused: 0, dismissed: 0 })).toBe(
      "Other QIDs are filled in",
    );
  });
});

describe("moveRowIds", () => {
  it("follows the renumbered rows of one disc and drops removed ones", () => {
    const dismissed = new Set(["0:1:comp:Q1", "0:2:track:Q2", "1:1:comp:Q3"]);
    expect([...moveRowIds(dismissed, renumberedRows(0, new Map([[1, 2]])))]).toEqual([
      "0:2:comp:Q1",
      "1:1:comp:Q3",
    ]);
  });

  it("moves the discs after a removed one down and drops its own", () => {
    const ids = ["0:1:comp:Q1", "1:4:comp:Q9", "2:3", "2:3:track:Q2"];
    expect([...moveRowIds(ids, removedDisc(1))]).toEqual(["0:1:comp:Q1", "1:3", "1:3:track:Q2"]);
  });
});

describe("takenLine", () => {
  const row: Track = { n: 1, title: "T1", artists: ["A"], seconds: 0, mb: null };
  const rows = {
    "0:1": rm({ comp: [match("Q1"), match("Q2"), match("Q3")], track: [track("Q50", "Q1")] }),
  };

  it("counts the candidates another QID keeps out, compositions first", () => {
    const disc = emptyDisc();
    expect(takenLine(reviewTracks([disc], [[row]], rows, new Set())[0])).toBe("");
    disc.comp[1] = "Q1";
    expect(takenLine(reviewTracks([disc], [[row]], rows, new Set())[0])).toBe(
      "2 other compositions",
    );
    disc.track[1] = "Q9";
    expect(takenLine(reviewTracks([disc], [[row]], rows, new Set())[0])).toBe(
      "2 other compositions and 1 other track",
    );
  });
});
