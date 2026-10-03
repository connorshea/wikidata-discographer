import { describe, expect, it } from "vite-plus/test";
import { assembleMatches, type ItemFacts } from "./matches.ts";
import { labelSearchKey } from "./mirror.ts";

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
    expect(rows["0:1"].comp.map((m) => [m.qid, m.reasons])).toEqual([["Q20", ["recorded as Q10"]]]);
    // The single has the title but no performer; it's suggested through the track.
    expect(rows["0:1"].single.map((m) => [m.qid, m.reasons])).toEqual([["Q30", ["has Q10 on it"]]]);
  });

  it("ignores same-title items by someone else, unless they're on the album", () => {
    const items = mapOf(
      facts("Q10", "track", "Soft", { P175: ["Q999"] }),
      facts("Q11", "work", "Soft", { P86: ["Q52583"] }),
      facts("Q12", "track", "Soft"),
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

  it("treats curly and straight apostrophes alike", () => {
    const items = mapOf(facts("Q10", "work", "Don't Leave Me", { P175: ["Q52583"] }));
    const { rows } = assembleMatches([row("Don’t Leave Me")], { items, albumTracks: new Set() });
    expect(rows["0:1"].comp.map((m) => m.qid)).toEqual(["Q10"]);
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
});
