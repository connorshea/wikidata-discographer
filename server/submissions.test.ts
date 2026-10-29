import { describe, expect, it } from "vite-plus/test";
import { coerceState } from "../src/lib/state.ts";
import { editGroupUrl, editSummary, MAX_RUN_ARTISTS, runArtists } from "./submissions.ts";

describe("editSummary", () => {
  it("credits the tool and links the EditGroup", () => {
    expect(editSummary("Created track", "0123456789abcdef")).toBe(
      "Created track (Wikidata Discographer) ([[:toolforge:editgroups/b/CB/0123456789abcdef|details]])",
    );
  });

  it("shortens long text but keeps the EditGroups link whole", () => {
    const s = editSummary("x".repeat(1000), "0123456789abcdef");
    expect(s.length).toBeLessThanOrEqual(400);
    expect(s).toMatch(
      /…\s\(Wikidata Discographer\) \(\[\[:toolforge:editgroups\/b\/CB\/0123456789abcdef\|details\]\]\)$/,
    );
  });
});

describe("editGroupUrl", () => {
  it("points at the EditGroups batch", () => {
    expect(editGroupUrl("abc")).toBe("https://editgroups.toolforge.org/b/CB/abc/");
  });
});

describe("runArtists", () => {
  /** A form for a new album by `artists`, mapped to QIDs by `mapped`. */
  const newAlbum = (artists: string[], mapped: Record<string, string>) => {
    const s = coerceState(null);
    s.album.mode = "create";
    s.album.artists = artists;
    s.artists = mapped;
    return s;
  };

  it("names the mirror's performers by their labels", () => {
    const s = coerceState(null);
    s.album.mode = "existing";
    expect(runArtists(s, [{ qid: "Q1", label: "Björk" }])).toEqual([{ qid: "Q1", label: "Björk" }]);
  });

  it("puts a new album's artists first, in the form's order", () => {
    const s = newAlbum(["B", "A"], { A: "Q1", B: "Q2" });
    const linked = [
      { qid: "Q1", label: "Artist A" },
      { qid: "Q2", label: null },
    ];
    expect(runArtists(s, linked)).toEqual([
      { qid: "Q2", label: "B" },
      { qid: "Q1", label: "Artist A" },
    ]);
  });

  it("falls back to the form's artists when the mirror has none", () => {
    const s = newAlbum(["A", "No QID", "A"], { A: " Q1 ", "No QID": "" });
    expect(runArtists(s, [])).toEqual([{ qid: "Q1", label: "A" }]);
  });

  it("ignores the form's artists for an existing album", () => {
    const s = newAlbum(["A"], { A: "Q1" });
    s.album.mode = "existing";
    expect(runArtists(s, [])).toEqual([]);
  });

  it("leaves out Various artists and stops at the limit", () => {
    const linked = ["Q3108914", "Q1", "Q2", "Q3", "Q4"].map((qid) => ({ qid, label: qid }));
    const got = runArtists(coerceState(null), linked);
    expect(got.map((a) => a.qid)).toEqual(["Q1", "Q2", "Q3"].slice(0, MAX_RUN_ARTISTS));
  });
});
