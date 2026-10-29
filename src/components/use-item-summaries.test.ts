import { describe, expect, it } from "vite-plus/test";
import { releaseKind } from "./use-item-summaries.ts";

describe("releaseKind", () => {
  it("says EP when any class is an EP, then single, then album", () => {
    expect(releaseKind(["Q482994", "Q169930"])).toBe("EP");
    expect(releaseKind(["Q482994", "Q134556"])).toBe("Single");
    expect(releaseKind(["Q482994"])).toBe("Album");
    expect(releaseKind([])).toBe("Album");
  });
});
