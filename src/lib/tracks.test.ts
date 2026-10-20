import { describe, expect, it } from "vite-plus/test";
import { EXAMPLE } from "./example.fixture.ts";
import { emptyDisc } from "./state.ts";
import {
  addTrack,
  formatLength,
  insertTracks,
  moveTrack,
  parseLength,
  pastedTracks,
  commonArtists,
  removeTrack,
  rowPerformers,
} from "./tracks.ts";

describe("parseLength", () => {
  it("reads m:ss and h:mm:ss", () => {
    expect(parseLength("3:14")).toEqual({ ok: true, seconds: 194 });
    expect(parseLength(" 03:14 ")).toEqual({ ok: true, seconds: 194 });
    expect(parseLength("72:00")).toEqual({ ok: true, seconds: 4320 });
    expect(parseLength("1:02:03")).toEqual({ ok: true, seconds: 3723 });
    expect(parseLength("")).toEqual({ ok: true, seconds: null });
  });

  it("rejects anything else", () => {
    for (const s of ["3:2", "3:60", "194", "3.14", "1:2:03", "a:bc"])
      expect(parseLength(s)).toEqual({ ok: false });
  });
});

describe("formatLength", () => {
  it("writes m:ss, with hours from an hour up", () => {
    expect(formatLength(194)).toBe("3:14");
    expect(formatLength(5)).toBe("0:05");
    expect(formatLength(3723)).toBe("1:02:03");
    expect(formatLength(null)).toBe("");
  });
});

describe("editing rows", () => {
  /** Disc 1 of the example, with links on tracks 1 and 2. */
  const disc = () => {
    const d = structuredClone(EXAMPLE.discs[0]);
    d.comp = { 1: "Q1" };
    d.track = { 2: "Q2" };
    return d;
  };
  const titles = (d: ReturnType<typeof disc>) => d.tracks.slice(0, 4).map((t) => t.title);

  it("moves a row, renumbering the disc and keeping each row's links", () => {
    const d = disc();
    const [a, b, c] = titles(d);
    const moved = moveTrack(d, 0, 2);
    expect(titles(d).slice(0, 3)).toEqual([b, c, a]);
    expect(d.tracks.map((t) => t.n).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(d.comp).toEqual({ 3: "Q1" });
    expect(d.track).toEqual({ 1: "Q2" });
    expect(moved.get(1)).toBe(3);
    expect(moved.get(4)).toBe(4);
  });

  it("removes a row and its links, renumbering the rest", () => {
    const d = disc();
    const count = d.tracks.length;
    const moved = removeTrack(d, 1);
    expect(d.tracks).toHaveLength(count - 1);
    expect(d.tracks.at(-1)?.n).toBe(count - 1);
    expect(d.comp).toEqual({ 1: "Q1" });
    expect(d.track).toEqual({});
    expect(moved.has(2)).toBe(false);
  });

  it("inserts rows after one, and adds a blank row at the end", () => {
    const d = emptyDisc();
    addTrack(d);
    expect(d.tracks).toEqual([{ n: 1, title: "", artists: [], seconds: null, mb: null }]);
    d.comp = { 1: "Q1" };
    insertTracks(d, -1, [{ title: "First", artists: [], seconds: null, mb: null }]);
    expect(d.tracks.map((t) => [t.n, t.title])).toEqual([
      [1, "First"],
      [2, ""],
    ]);
    expect(d.comp).toEqual({ 2: "Q1" });
  });
});

describe("pastedTracks", () => {
  it("splits a pasted list into titles and lengths", () => {
    expect(
      pastedTracks("1. After All (4:12)\n\n02) Habits of Creatures - 2:57\nVersailles\n"),
    ).toEqual([
      { title: "After All", length: "4:12" },
      { title: "Habits of Creatures", length: "2:57" },
      { title: "Versailles", length: "" },
    ]);
  });

  it("reads spreadsheet columns", () => {
    expect(pastedTracks("1\tOn Wires\t3:22\n2\tBlue Skies\t2:29")).toEqual([
      { title: "On Wires", length: "3:22" },
      { title: "Blue Skies", length: "2:29" },
    ]);
  });

  it("leaves titles that only look numbered alone", () => {
    expect(pastedTracks("1999\n22 (Taylor's Version)")).toEqual([
      { title: "1999", length: "" },
      { title: "22 (Taylor's Version)", length: "" },
    ]);
  });

  it("leaves a single line to paste as usual", () => {
    expect(pastedTracks("After All (4:12)")).toBeNull();
    expect(pastedTracks("After All\n")).toBeNull();
  });
});

describe("rowPerformers", () => {
  const none = { only: [], with: [], feat: [] };
  it("lists nothing for the artists on every track", () => {
    expect(rowPerformers({ artists: ["A"] }, ["A"])).toEqual(none);
    expect(rowPerformers({ artists: ["B", "A"] }, ["A", "B"])).toEqual(none);
    expect(rowPerformers({ artists: [] }, ["A"])).toEqual(none);
  });

  it("lists featured and other artists, or only the row's own", () => {
    expect(rowPerformers({ artists: ["A", "F"], feat: ["F"] }, ["A"])).toEqual({
      ...none,
      feat: ["F"],
    });
    expect(rowPerformers({ artists: ["A", "B", "G"] }, ["A", "B"])).toEqual({
      ...none,
      with: ["G"],
    });
    expect(rowPerformers({ artists: ["B", "F"], feat: ["F"] }, ["A", "B"])).toEqual({
      only: ["B"],
      with: [],
      feat: ["F"],
    });
    expect(rowPerformers({ artists: ["C"] }, [])).toEqual({ ...none, with: ["C"] });
  });
});

describe("commonArtists", () => {
  it("finds the main artists every credited row has", () => {
    expect(
      commonArtists([
        { artists: ["A", "B"] },
        { artists: [] },
        { artists: ["B", "A", "F"], feat: ["F"] },
      ]),
    ).toEqual(["A", "B"]);
    expect(commonArtists([{ artists: ["A"] }, { artists: ["B", "A"], feat: ["A"] }])).toEqual([]);
    expect(commonArtists([])).toEqual([]);
  });
});
