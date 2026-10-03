import { describe, expect, it } from "vite-plus/test";
import { buildPlan, describeOp, QID } from "./plan.ts";
import { formatDuration, formatTime, previewPlan } from "./preview.ts";
import { EXAMPLE } from "./state.ts";

describe("formatTime", () => {
  it("shows a date at its precision", () => {
    expect(formatTime("+2026-09-18T00:00:00Z", 11)).toBe("18 September 2026");
    expect(formatTime("+2026-09-00T00:00:00Z", 10)).toBe("September 2026");
    expect(formatTime("+2026-00-00T00:00:00Z", 9)).toBe("2026");
  });
});

describe("formatDuration", () => {
  it("shows minutes and seconds, and hours when there are any", () => {
    expect(formatDuration(252)).toBe("4:12");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});

describe("previewPlan", () => {
  const state = structuredClone(EXAMPLE);
  state.album.mode = "create";
  state.discs[0].single["2"] = { date: "2026-05-01", qid: "" };
  const plan = buildPlan(state);
  const groups = previewPlan(plan, state);
  const edits = groups.flatMap((g) => g.edits);

  it("has one entry per edit, headed as the run log describes it", () => {
    expect(edits).toHaveLength(plan.ops.length);
    expect(edits.map((e) => e.n).toSorted((a, b) => a - b)).toEqual(plan.ops.map((_, i) => i + 1));
    for (const e of edits) {
      const op = plan.ops[e.n - 1];
      expect(e.heading).toBe(op.op === "create" ? `Create ${describeOp(op)}` : describeOp(op));
    }
  });

  it("groups by what each edit makes or changes", () => {
    expect(groups.map((g) => g.id)).toEqual(["album", "comp", "track", "single", "existing"]);
    const [album] = groups;
    expect(album.edits.map((e) => e.heading)).toEqual([
      "Create album “Day and Night”",
      expect.stringMatching(/^Add 24 statements to album tracklist$/),
    ]);
    // The reused composition only gains a performer.
    expect(groups.at(-1)!.edits.map((e) => e.target?.qid)).toEqual(["Q140882264"]);
  });

  it("labels properties and items, and names new items by title", () => {
    const track = groups.find((g) => g.id === "track")!.edits[0];
    expect(track.heading).toBe("Create track “After All”");
    expect(track.terms[0]).toEqual({ kind: "Label", language: "English", text: "After All" });
    const show = (e: typeof track) =>
      e.statements.map((s) => [s.property.label, s.value.text, s.value.isNew ?? false]);
    expect(show(track)).toEqual(
      expect.arrayContaining([
        ["instance of", "music track with vocals", false],
        ["title", "“After All” (English)", false],
        ["performer", "Carly Rae Jepsen", false],
        ["recording or performance of", "composition “After All”", false],
        ["duration", "4:12", false],
        ["publication date", "18 September 2026", false],
        ["published in", "new album “Day and Night”", true],
      ]),
    );

    // Disc 2, track 2.
    const tracklist = groups[0].edits[1].statements[13];
    expect(tracklist.property.label).toBe("tracklist");
    expect(tracklist.value).toEqual({ text: "new track “Amalfi Coast”", isNew: true });
    expect(tracklist.qualifiers.map((q) => [q.property.label, q.value.text])).toEqual([
      ["series ordinal", "2"],
      ["applies to part", "CD2"],
    ]);
  });

  it("leaves no ID without a label when the app knows one", () => {
    for (const e of edits)
      for (const s of e.statements)
        for (const x of [s, ...s.qualifiers]) {
          expect(x.property.label).not.toBeNull();
          expect(QID.test(x.value.text)).toBe(false);
        }
  });

  it("calls an existing album “this album”", () => {
    const plan = buildPlan(EXAMPLE);
    const [album] = previewPlan(plan, EXAMPLE);
    expect(album.edits[0].target).toEqual({ text: "this album", qid: "Q140316456" });
  });
});
