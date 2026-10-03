import { describe, expect, it } from "vite-plus/test";
import { rankDuplicates, titleReasons } from "./duplicates.ts";
import type { DuplicateMatch } from "../src/lib/api-types.ts";

describe("titleReasons", () => {
  it("keeps every same-title album while the artists have no QIDs", () => {
    expect(titleReasons(["Q999"], [])).toEqual(["same title"]);
  });

  it("keeps an album by one of the artists", () => {
    expect(titleReasons(["Q999", "Q52583"], ["Q52583"])).toEqual(["same title", "same performer"]);
  });

  it("keeps an album with no performer, as a guess", () => {
    expect(titleReasons([], ["Q52583"])).toEqual(["same title", "no artist set"]);
  });

  it("leaves out an album by someone else", () => {
    expect(titleReasons(["Q999"], ["Q52583"])).toBeNull();
  });
});

describe("rankDuplicates", () => {
  const match = (qid: string, ...reasons: string[]): DuplicateMatch => ({
    qid,
    kind: "album",
    label: "Day and Night",
    description: null,
    reasons,
  });

  it("puts identifier matches first, then the same performer, then no artist", () => {
    const ranked = rankDuplicates([
      match("Q1", "same title", "no artist set"),
      match("Q2", "same title"),
      match("Q3", "same title", "same performer"),
      match("Q4", "same Spotify album ID"),
    ]);
    expect(ranked.map((m) => m.qid)).toEqual(["Q4", "Q3", "Q2", "Q1"]);
  });
});
