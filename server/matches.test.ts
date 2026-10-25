import { describe, expect, it } from "vite-plus/test";
import { assembleMatches, type ItemFacts } from "./matches.ts";
import { labelSearchKey } from "../src/lib/titles.ts";

const facts = (
  qid: string,
  kind: ItemFacts["kind"],
  label: string,
  links: Record<string, string[]> = {},
): ItemFacts => ({
  qid,
  kind,
  label,
  description: null,
  labelSearch: labelSearchKey(label),
  links: Object.entries(links).flatMap(([property, ts]) =>
    ts.map((target) => ({ property, target })),
  ),
});
const mapOf = (...items: ItemFacts[]) => new Map(items.map((it) => [it.qid, it]));
const row = (title: string, performers = ["Q52583"]) => ({ key: "0:1", title, performers });

describe("assembleMatches", () => {
  it("matches title and performer, and brings the track's composition and single", () => {
    const items = mapOf(
      facts("Q10", "track", "Wild Child", { P175: ["Q52583"], P2550: ["Q20"], P1433: ["Q30"] }),
      facts("Q20", "work", "Wild Child (song)"),
      facts("Q30", "single", "Wild Child"),
    );
    const { rows } = assembleMatches([row("wild child")], { items, albumTracks: new Set() });
    expect(rows["0:1"].track).toEqual([
      {
        qid: "Q10",
        kind: "track",
        label: "Wild Child",
        description: null,
        reasons: ["same title", "same performer"],
        composition: "Q20",
        singles: ["Q30"],
      },
    ]);
    // The composition is also a similar title, but it's reached through a same-title track.
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q20", ["no artist set", "recorded as Q10"]],
    ]);
    // The single has the title but no artist, and is also on the track.
    expect(rows["0:1"].single.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q30", ["same title", "no artist set", "has Q10 on it"]],
    ]);
  });

  it("ignores same-title items by someone else, unless they're on the album", () => {
    const items = mapOf(
      facts("Q10", "track", "Soft", { P175: ["Q999"] }),
      facts("Q11", "work", "Soft", { P86: ["Q52583"] }),
      facts("Q12", "track", "Soft", { P175: ["Q999"] }),
    );
    const { rows } = assembleMatches([row("Soft")], { items, albumTracks: new Set(["Q12"]) });
    expect(rows["0:1"].track.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q12", ["same title", "on this album"]],
    ]);
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q11", ["same title", "same composer or lyricist"]],
    ]);
    expect(assembleMatches([row("Soft", [])], { items, albumTracks: new Set() }).rows).toEqual({});
  });

  it("suggests same-title items with no artist, after credited ones", () => {
    const items = mapOf(
      facts("Q10", "track", "On Wires"),
      facts("Q11", "track", "On Wires", { P175: ["Q52583"] }),
      facts("Q12", "work", "On Wires", { P2550: ["Q99"] }),
      facts("Q13", "single", "On Wires", { P175: ["Q999"] }),
    );
    const { rows } = assembleMatches([row("On Wires")], { items, albumTracks: new Set() });
    expect(rows["0:1"].track.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q11", ["same title", "same performer"]],
      ["Q10", ["same title", "no artist set"]],
    ]);
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q12", ["same title", "no artist set"]],
    ]);
    expect(rows["0:1"].single).toEqual([]);
  });

  it("treats curly and straight apostrophes alike", () => {
    const items = mapOf(facts("Q10", "work", "Don't Leave Me", { P175: ["Q52583"] }));
    const { rows } = assembleMatches([row("Don’t Leave Me")], { items, albumTracks: new Set() });
    expect(rows["0:1"].comp.map((m) => m.qid)).toEqual(["Q10"]);
  });

  it("matches a similar title, after the same title, and passes it on to linked items", () => {
    const items = mapOf(
      facts("Q10", "track", "Post Break-Up Sex", { P175: ["Q52583"], P2550: ["Q20"] }),
      facts("Q11", "track", "Post Break Up Sex", { P175: ["Q52583"], P2550: ["Q21"] }),
      facts("Q20", "work", "Some Other Title"),
      facts("Q21", "work", "Another Title"),
      facts("Q30", "single", "Post Breakup Sex", { P175: ["Q52583"] }),
    );
    // MusicBrainz writes the hyphen as U+2010, which is still the same title.
    const { rows } = assembleMatches([row("Post Break‐Up Sex")], { items, albumTracks: new Set() });
    expect(rows["0:1"].track.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q10", ["same title", "same performer"]],
      ["Q11", ["similar title", "same performer"]],
    ]);
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q20", ["recorded as Q10"]],
      ["Q21", ["recorded as Q11", "similar title"]],
    ]);
    // "Breakup" is a different word, not a folded "Break-Up".
    expect(rows["0:1"].single).toEqual([]);
  });

  it("matches an item whose label has a disambiguator as a similar title", () => {
    const items = mapOf(
      facts("Q15646391", "work", "Coming of Age (song)", { P175: ["Q61113"] }),
      facts("Q16610295", "single", "Coming of Age (Foster the People song)", { P175: ["Q61113"] }),
    );
    const { rows } = assembleMatches([row("Coming of Age", ["Q61113"])], {
      items,
      albumTracks: new Set(),
    });
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q15646391", ["similar title", "same performer"]],
    ]);
    expect(rows["0:1"].single.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q16610295", ["similar title", "same performer"]],
    ]);
  });

  it("drops the similar title from an item also reached through the same title", () => {
    const items = mapOf(
      facts("Q10", "track", "Day and Night", { P175: ["Q52583"], P2550: ["Q20"] }),
      facts("Q11", "track", "Day & Night", { P175: ["Q52583"], P2550: ["Q20"] }),
      facts("Q20", "work", "Day & Night"),
    );
    const { rows } = assembleMatches([row("Day and Night")], { items, albumTracks: new Set() });
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([
      ["Q20", ["no artist set", "recorded as Q10", "recorded as Q11"]],
    ]);
  });

  it("finds a single's track, and orders album tracks first", () => {
    const items = mapOf(
      facts("Q30", "single", "Diver", { P175: ["Q52583"], P658: ["Q11", "Q12"] }),
      facts("Q11", "track", "Diver", { P2550: ["Q20"] }),
      facts("Q12", "track", "Diver (Remix)"),
      facts("Q20", "work", "Diver"),
      facts("Q13", "track", "Diver", { P175: ["Q52583"] }),
    );
    const { rows } = assembleMatches([row("Diver")], { items, albumTracks: new Set(["Q13"]) });
    expect(rows["0:1"].track.map((m) => [m.qid, m.composition, m.singles])).toEqual([
      ["Q13", null, []],
      ["Q11", "Q20", ["Q30"]],
    ]);
    expect(rows["0:1"].comp.map((m) => m.qid)).toEqual(["Q20"]);
  });

  it("leaves out singles taken from another album", () => {
    const items = mapOf(
      facts("Q10", "track", "Glow", { P175: ["Q52583"], P1433: ["Q30", "Q31"] }),
      facts("Q30", "single", "Glow", { P175: ["Q52583"], P13602: ["Q40"] }),
      facts("Q31", "single", "Glow", { P175: ["Q52583"], P13602: ["Q41"] }),
      facts("Q32", "single", "Glow", { P175: ["Q52583"], P658: ["Q10"] }),
    );
    const singles = (album: string | null) => {
      const { rows } = assembleMatches([row("Glow")], { items, albumTracks: new Set(), album });
      return [rows["0:1"].single.map((m) => m.qid), rows["0:1"].track[0].singles];
    };
    expect(singles(null)).toEqual([["Q32"], ["Q32"]]);
    // One taken from the album being added to is still its single.
    expect(singles("Q41")).toEqual([
      ["Q31", "Q32"],
      ["Q31", "Q32"],
    ]);
  });

  it("leaves out a studio track for a live row, but keeps its composition", () => {
    const LIVE = "Q56123235";
    const STUDIO = "Q15975575";
    const items = mapOf(
      facts("Q10", "track", "Golden Days", { P175: ["Q52583"], P2550: ["Q20"], P1552: [STUDIO] }),
      facts("Q11", "track", "Golden Days", { P175: ["Q52583"], P1552: [LIVE] }),
      facts("Q12", "track", "Golden Days", { P175: ["Q52583"] }),
      facts("Q13", "track", "Golden Days", { P175: ["Q52583"], P1552: [STUDIO] }),
      facts("Q20", "work", "Golden Days", { P86: ["Q52583"] }),
    );
    const matches = (recTypes: string[], albumTracks: string[] = []) => {
      const { rows } = assembleMatches([{ ...row("Golden Days"), recTypes }], {
        items,
        albumTracks: new Set(albumTracks),
      });
      return {
        track: rows["0:1"].track.map((m) => m.qid),
        comp: rows["0:1"].comp.map((m) => [m.qid, m.reasons]),
      };
    };
    expect(matches([LIVE])).toEqual({
      track: ["Q11", "Q12"],
      comp: [["Q20", ["recorded as Q10", "same title", "same composer or lyricist"]]],
    });
    expect(matches([STUDIO]).track).toEqual(["Q10", "Q12", "Q13"]);
    // Neither, or not saying: every track.
    expect(matches([]).track).toEqual(["Q10", "Q11", "Q12", "Q13"]);
    // On the album, it's this album's track whatever it says.
    expect(matches([LIVE], ["Q13"]).track).toEqual(["Q13", "Q11", "Q12"]);
  });
});
