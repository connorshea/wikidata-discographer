import { describe, expect, it } from "vite-plus/test";
import {
  buildPlan,
  MAX_TRACKS,
  MAX_TRACKS_PER_DISC,
  normalizeQid,
  type Op,
  parseDisc,
  splitArtists,
} from "./plan.ts";
import { EMPTY, emptyDisc, EXAMPLE } from "./state.ts";

const keys = (ops: Op[]) => ops.map((o) => (o.op === "create" ? o.key : `+${o.what}`));
const find = (ops: Op[], key: string) => ops.find((o) => o.op === "create" && o.key === key);

describe("normalizeQid", () => {
  it("turns URLs and lowercase q-numbers into bare QIDs", () => {
    expect(normalizeQid("https://www.wikidata.org/wiki/Q52583")).toBe("Q52583");
    expect(normalizeQid(" q42 ")).toBe("Q42");
    expect(normalizeQid("not a qid")).toBe("not a qid");
  });
});

describe("splitArtists", () => {
  it("splits on commas, ampersands and feat.", () => {
    expect(splitArtists("A, B & C feat. D", true)).toEqual(["A", "B", "C", "D"]);
    expect(splitArtists("A & B", false)).toEqual(["A & B"]);
  });
});

describe("parseDisc", () => {
  it("reads tracks and flags unreadable lines", () => {
    const rows = parseDisc("1. Song - Artist (3:05)\n\nnonsense", EMPTY.settings);
    expect(rows[0]).toMatchObject({ n: 1, title: "Song", artists: ["Artist"], seconds: 185 });
    expect(rows[1]).toMatchObject({ error: expect.any(String), raw: "nonsense" });
  });
});

describe("buildPlan", () => {
  it("is not ready for an empty form", () => {
    const plan = buildPlan(EMPTY);
    expect(plan.ready).toBe(false);
    expect(plan.ops).toEqual([]);
  });

  it("orders compositions, then tracks, then the album tracklist", () => {
    const plan = buildPlan(EXAMPLE);
    expect(plan.ready).toBe(true);
    const k = keys(plan.ops);
    // Disc 1 track 1 reuses an existing composition, so it only gains P175.
    expect(plan.ops[0]).toMatchObject({ op: "addClaims", target: { id: "Q140882264" } });
    expect(k.indexOf("comp:1:12")).toBeLessThan(k.indexOf("track:0:1"));
    expect(k.at(-1)).toBe("+album tracklist");
    expect(plan.ops).toHaveLength(1 + 23 + 24 + 1);
  });

  it("links created items by reference", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "" };
    const { ops, ready } = buildPlan(state);
    expect(ready).toBe(true);
    expect(keys(ops)[0]).toBe("album");

    const track = find(ops, "track:0:2");
    expect(track?.op === "create" && track.claims).toEqual(
      expect.arrayContaining([
        { property: "P2550", value: { type: "item", ref: "comp:0:2" } },
        { property: "P1433", value: { type: "item", ref: "album" } },
      ]),
    );
    const single = find(ops, "single:0:2");
    expect(single?.op === "create" && single.claims).toEqual(
      expect.arrayContaining([
        { property: "P13602", value: { type: "item", ref: "album" } },
        expect.objectContaining({ property: "P658", value: { type: "item", ref: "track:0:2" } }),
      ]),
    );
    // The track gets P1433 the single once the single exists.
    expect(ops.at(-1)).toMatchObject({
      op: "addClaims",
      target: { ref: "track:0:2" },
      claims: [{ property: "P1433", value: { type: "item", ref: "single:0:2" } }],
    });
  });

  it("puts the disc and position on each tracklist statement", () => {
    const { ops } = buildPlan(EXAMPLE);
    const tracklist = ops.at(-1);
    expect(tracklist?.op === "addClaims" && tracklist.claims[12]).toEqual({
      property: "P658",
      value: { type: "item", ref: "track:1:1" },
      qualifiers: [
        { property: "P1545", value: { type: "string", value: "1" } },
        { property: "P518", value: { type: "item", id: "Q61629680" } },
      ],
    });
  });

  it("blocks on a bad performer QID", () => {
    const state = structuredClone(EXAMPLE);
    state.artists["Carly Rae Jepsen"] = "Carly";
    expect(buildPlan(state).ready).toBe(false);
  });

  describe("size limits", () => {
    const tracklist = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `${i + 1}. Song ${i + 1} - Carly Rae Jepsen (3:00)`,
      ).join("\n");
    const withDiscs = (...counts: number[]) => {
      const state = structuredClone(EXAMPLE);
      state.discs = counts.map((n) => ({ ...emptyDisc(), text: tracklist(n) }));
      return state;
    };
    const errors = (plan: ReturnType<typeof buildPlan>) =>
      plan.messages.filter((m) => m[0] === "err").map((m) => m[1]);

    it("allows a full disc and blocks one track more", () => {
      expect(buildPlan(withDiscs(MAX_TRACKS_PER_DISC)).ready).toBe(true);
      const plan = buildPlan(withDiscs(3, MAX_TRACKS_PER_DISC + 1));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `Disc 2 has ${MAX_TRACKS_PER_DISC + 1} tracks, but a disc can have at most ${MAX_TRACKS_PER_DISC}. ` +
          "Split it into more discs, or into separate runs.",
      ]);
    });

    it("allows a full run and blocks one track more across all discs", () => {
      expect(buildPlan(withDiscs(MAX_TRACKS_PER_DISC, MAX_TRACKS_PER_DISC)).ready).toBe(true);
      const plan = buildPlan(withDiscs(MAX_TRACKS_PER_DISC, MAX_TRACKS_PER_DISC, 1));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `That's ${MAX_TRACKS + 1} tracks across all discs, but a run can have at most ${MAX_TRACKS}. ` +
          "Split the release into separate runs.",
      ]);
    });
  });
});
