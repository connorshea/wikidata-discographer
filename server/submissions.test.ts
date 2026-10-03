import { describe, expect, it } from "vite-plus/test";
import { editGroupUrl, editSummary } from "./submissions.ts";

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
