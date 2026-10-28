import { describe, expect, it } from "vite-plus/test";
import { buildPlan, describeOp, QID } from "./plan.ts";
import { formatDuration, formatTime, previewPlan } from "./preview.ts";
import { EXAMPLE } from "./example.fixture.ts";

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
    expect(groups.map((g) => g.id)).toEqual(["album", "comp", "track", "existing"]);
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
    expect(track.terms[1]).toEqual({
      kind: "Label",
      language: "multiple languages",
      text: "After All",
    });
    const show = (e: typeof track) =>
      e.statements.map((s) => [s.property.label, s.value.text, s.value.isNew ?? false]);
    expect(show(track)).toEqual(
      expect.arrayContaining([
        ["instance of", "music track with vocals", false],
        ["title", "“After All” (English)", false],
        ["performer", "Carly Rae Jepsen", false],
        ["recording or performance of", "composition “After All”", false],
        ["duration", "4:12", false],
      ]),
    );
    const comp = groups.find((g) => g.id === "comp")!.edits[0];
    expect(show(comp).map(([label]) => label)).not.toContain("publication date");

    // Disc 2, track 2.
    const tracklist = groups[0].edits[1].statements[13];
    expect(tracklist.property.label).toBe("tracklist");
    expect(tracklist.value).toEqual({ text: "new track “Amalfi Coast”", isNew: true });
    expect(tracklist.qualifiers.map((q) => [q.property.label, q.value.text])).toEqual([
      ["series ordinal", "2"],
      ["applies to part", "CD2"],
    ]);
  });

  it("says what item each edit is about, and the row it's for", () => {
    const about = (e: (typeof edits)[number]) => [e.kind, e.creates, e.title, e.place];
    const byGroup = (id: string) => groups.find((g) => g.id === id)!.edits;
    expect(byGroup("album").map(about)).toEqual([
      ["album", true, "Day and Night", null],
      ["album", false, "Album tracklist", null],
    ]);
    expect(about(byGroup("track")[0])).toEqual(["track", true, "After All", { disc: 1, n: 1 }]);
    // The reused composition, which only gains a performer.
    const [reused] = byGroup("existing");
    expect(about(reused)).toEqual(["comp", false, "After All", { disc: 1, n: 1 }]);
    expect(reused.target).toEqual({
      text: "composition “After All”",
      qid: "Q140882264",
      reused: true,
    });
  });

  it("places each edit to a shared item at its own row", () => {
    const shared = structuredClone(state);
    shared.discs[0].comp["2"] = shared.discs[0].comp["1"];
    const existing = previewPlan(buildPlan(shared), shared).find((g) => g.id === "existing")!;
    expect(existing.edits.map((e) => [e.title, e.place])).toEqual([
      ["After All", { disc: 1, n: 1 }],
      ["Habits of Creatures", { disc: 1, n: 2 }],
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

  it("labels a streaming album's distribution format", () => {
    const streaming = structuredClone(state);
    streaming.album.ids.spotify = "4aawyAB9vmqN3uQ7FjRGTy";
    const format = previewPlan(buildPlan(streaming), streaming)
      .flatMap((g) => g.edits)
      .flatMap((e) => e.statements)
      .find((s) => s.property.id === "P437")!;
    expect([format.property.label, format.value.text]).toEqual([
      "distribution format",
      "music streaming",
    ]);
  });

  it("shows a MusicBrainz ID with the name it's named as", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].tracks[1].mb = {
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      work: "",
      recordingName: "You’re My Woman (original stereo mix)",
      workName: "",
      iswcs: [],
      isrcs: [],
      spotify: [],
      appleMusic: [],
      deezer: [],
      tidal: [],
      composers: [],
      lyricists: [],
      source: null,
    };
    const id = previewPlan(buildPlan(state), state)
      .flatMap((g) => g.edits)
      .flatMap((e) => e.statements)
      .find((s) => s.property.id === "P4404")!;
    expect(id.qualifiers.map((q) => [q.property.label, q.value.text])).toEqual([
      ["subject named as", "You’re My Woman (original stereo mix)"],
    ]);
  });

  it("calls an existing album “this album”", () => {
    const plan = buildPlan(EXAMPLE);
    const [album] = previewPlan(plan, EXAMPLE);
    expect(album.edits[0].target).toEqual({ text: "this album", qid: "Q140316456" });
  });

  it("calls an existing single a single", () => {
    const plan = buildPlan(EXAMPLE);
    const [album] = previewPlan(plan, EXAMPLE, true);
    expect(album.edits[0]).toMatchObject({
      title: "Single tracklist",
      noun: "single",
      target: { text: "this single", qid: "Q140316456" },
    });
  });
});
