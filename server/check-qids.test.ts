import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkPlanQids, forgetCheckedQids, planQids } from "./check-qids.ts";
import { buildPlan, type Op } from "../src/lib/plan.ts";
import { EXAMPLE } from "../src/lib/example.fixture.ts";

/** What the mirror has with a new item's label and description. */
const findByTerms = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []));
vi.mock("./mirror.ts", () => ({ findByTerms }));

describe("planQids", () => {
  const ops: Op[] = [
    {
      op: "create",
      key: "track:0:1",
      kind: "track",
      labels: { en: "Intro" },
      descriptions: {},
      claims: [
        { property: "P175", value: { type: "item", id: "Q1" } },
        {
          property: "P361",
          value: { type: "item", ref: "album" },
          qualifiers: [{ property: "P518", value: { type: "item", id: "Q2" } }],
        },
        { property: "P2047", value: { type: "quantity", amount: 60, unit: "Q11574" } },
      ],
    },
    {
      op: "addClaims",
      target: { id: "Q3" },
      what: "album",
      claims: [{ property: "P658", value: { type: "item", ref: "track:0:1" } }],
    },
    { op: "addClaims", target: { ref: "album" }, what: "album", claims: [] },
  ];

  it("takes targets, values, qualifiers and units, but not items the run creates", () => {
    expect([...planQids(ops).keys()].toSorted()).toEqual(["Q1", "Q11574", "Q2", "Q3"]);
  });
});

/** Answer wbgetentities: listed ids are missing or redirect, the rest exist. */
function stubWiki({
  missing = [],
  redirects = {},
  tooBig = [],
  instanceOf = ["Q482994"],
  tracklist = [],
  compositions = {},
  classes = {},
  terms = {},
}: {
  missing?: string[];
  redirects?: Record<string, string>;
  tooBig?: string[];
  /** The album's P31 values. */
  instanceOf?: string[];
  /** The album's P658 values. */
  tracklist?: string[];
  /** Each track's P2550 values. */
  compositions?: Record<string, string[]>;
  /** P31 values of items fetched with their claims. */
  classes?: Record<string, string[]>;
  /** English label and description, and any mul label, of items fetched for their terms. */
  terms?: Record<string, [string | undefined, string, string?]>;
}) {
  const term = (en: string | undefined, mul?: string) => ({
    ...(en ? { en: { language: "en", value: en } } : {}),
    ...(mul ? { mul: { language: "mul", value: mul } } : {}),
  });
  const fetch = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get("action") === "wbgetclaims") {
      const property = q.get("property")!;
      const values = { P31: instanceOf, P658: tracklist }[property];
      expect(values).toBeDefined();
      return Response.json({
        claims: {
          [property]: values!.map((id) => ({
            mainsnak: { snaktype: "value", property, datavalue: { value: { id } } },
            rank: "normal",
          })),
        },
      });
    }
    expect(q.get("action")).toBe("wbgetentities");
    if (q.get("props")!.includes("claims")) {
      const ids = q.get("ids")!.split("|");
      expect(ids.length).toBeLessThanOrEqual(50);
      const claim = (property: string) => (id: string) => ({
        mainsnak: { snaktype: "value", property, datavalue: { value: { id } } },
        rank: "normal",
      });
      return Response.json({
        entities: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              id,
              type: "item",
              lastrevid: 1,
              labels: term(terms[id]?.[0], terms[id]?.[2]),
              descriptions: term(terms[id]?.[1]),
              claims: {
                P2550: (compositions[id] ?? []).map(claim("P2550")),
                P31: (classes[id] ?? []).map(claim("P31")),
              },
            },
          ]),
        ),
      });
    }
    if (q.get("props") === "labels|descriptions") {
      const ids = q.get("ids")!.split("|");
      expect(ids.length).toBeLessThanOrEqual(50);
      expect(q.get("languages")).toBe("en|mul");
      return Response.json({
        entities: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              id,
              type: "item",
              labels: term(terms[id]?.[0], terms[id]?.[2]),
              descriptions: term(terms[id]?.[1]),
            },
          ]),
        ),
      });
    }
    expect(q.get("props")).toBe("info");
    const ids = q.get("ids")!.split("|");
    expect(ids.length).toBeLessThanOrEqual(50);
    const big = ids.find((id) => tooBig.includes(id));
    if (big)
      return Response.json({
        errors: [{ code: "no-such-entity", text: "Could not find", data: { id: big } }],
      });
    return Response.json({
      entities: Object.fromEntries(
        ids.map((id) => [
          id,
          missing.includes(id)
            ? { id, missing: "" }
            : redirects[id]
              ? { id: redirects[id], type: "item", redirects: { from: id, to: redirects[id] } }
              : { id, type: "item", lastrevid: 1 },
        ]),
      ),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("checkPlanQids", () => {
  const plan = buildPlan(EXAMPLE);
  beforeEach(() => forgetCheckedQids());
  afterEach(() => vi.unstubAllGlobals());

  it("passes when every item exists", async () => {
    const fetch = stubWiki({});
    expect(await checkPlanQids(plan.ops, EXAMPLE)).toEqual([]);
    expect(fetch).toHaveBeenCalled();
  });

  it("names a missing or redirected QID by where it was entered", async () => {
    const [performer, qid] = Object.entries(EXAMPLE.artists)[0];
    stubWiki({ missing: [EXAMPLE.album.qid], redirects: { [qid]: "Q99" } });
    const problems = await checkPlanQids(plan.ops, EXAMPLE);
    expect(problems).toContain(`The existing album: ${EXAMPLE.album.qid} doesn't exist.`);
    expect(problems).toContain(
      `Performer “${performer}”: ${qid} redirects to Q99; use Q99 instead.`,
    );
  });

  it("names a composer or lyricist's QID by their role", async () => {
    const state = structuredClone(EXAMPLE);
    const berger = { id: "ffadf26a-2593-4eaf-8c5d-a54cbc5aedc5", name: "Patrik Berger" };
    state.discs[0].tracks[0].mb = {
      recording: "",
      work: "",
      recordingName: "",
      workName: "",
      iswcs: [],
      isrcs: [],
      spotify: [],
      appleMusic: [],
      deezer: [],
      tidal: [],
      composers: [berger],
      lyricists: [],
      source: null,
    };
    state.artists["Patrik Berger"] = "Q1001";
    stubWiki({ missing: ["Q1001"] });
    const problems = await checkPlanQids(buildPlan(state).ops, state);
    expect(problems).toContain(`Composer “Patrik Berger”: Q1001 doesn't exist.`);
  });

  it("fetches only the existing album's “instance of” and tracklist statements", async () => {
    const fetch = stubWiki({ instanceOf: ["Q208569"] });
    expect(await checkPlanQids(plan.ops, EXAMPLE)).toEqual([]);
    const claims = fetch.mock.calls
      .map(([url]) => new URL(url).searchParams)
      .filter((q) => q.get("action") === "wbgetclaims");
    expect(claims.map((q) => [q.get("entity"), q.get("property")])).toEqual([
      [EXAMPLE.album.qid, "P31"],
      [EXAMPLE.album.qid, "P658"],
    ]);
  });

  it("refuses an existing album that already has a tracklist", async () => {
    stubWiki({ tracklist: ["Q1", "Q2"] });
    expect(await checkPlanQids(plan.ops, EXAMPLE)).toEqual([
      `The existing album: ${EXAMPLE.album.qid} already has a tracklist (P658) with 2 tracks. The app only adds tracklists to albums without one.`,
    ]);
  });

  it("refuses it even when the form reuses the listed tracks", async () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].track[1] = "Q1";
    stubWiki({ tracklist: ["Q1"] });
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      `The existing album: ${EXAMPLE.album.qid} already has a tracklist (P658) with 1 track. The app only adds tracklists to albums without one.`,
    ]);
  });

  it("refuses to give a reused track a second composition", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.discs[0].track[1] = "Q50"; // records Q60, and the form has its composition
    state.discs[0].comp[1] = "Q60";
    state.discs[0].track[2] = "Q51"; // records Q61, and the run would create one
    delete state.discs[0].comp[2];
    state.discs[0].track[3] = "Q52"; // records none
    delete state.discs[0].comp[3];
    stubWiki({ compositions: { Q50: ["Q60"], Q51: ["Q61"] } });
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 2 track: Q51 already records the composition Q61. Put Q61 in the track's composition field, so the track isn't given a second one.",
    ]);
    // A different composition in the field is refused too.
    state.discs[0].comp[2] = "Q62";
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 2 track: Q51 already records the composition Q61. Put Q61 in the track's composition field, so the track isn't given a second one.",
    ]);
  });

  it("says to fix a reused track that records a single instead of a composition", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.discs[0].track[1] = "Q51"; // records Q61, a single
    state.discs[0].comp[1] = "Q62";
    stubWiki({ compositions: { Q51: ["Q61"] }, classes: { Q61: ["Q134556"] } });
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 1 track: Q51 is a recording of (P2550) Q61, a single, not a composition. On Wikidata, change that statement to the composition Q62, then start the run again.",
    ]);
    // With no composition in the form, there's none to name.
    delete state.discs[0].comp[1];
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 1 track: Q51 is a recording of (P2550) Q61, a single, not a composition. On Wikidata, change that statement to the song's composition and put the composition in the track's composition field, then start the run again.",
    ]);
  });

  it("names a reused track's real composition over a release it also records", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.discs[0].track[1] = "Q51";
    state.discs[0].comp[1] = "Q62";
    stubWiki({
      compositions: { Q51: ["Q61", "Q63"] },
      classes: { Q61: ["Q482994"], Q63: ["Q105543609"] },
    });
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 1 track: Q51 already records the composition Q63. Put Q63 in the track's composition field, so the track isn't given a second one.",
    ]);
  });

  it("checks every row a reused track is in", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    // Q50 records Q60. One row has it, but the other would create a composition.
    state.discs[0].track[2] = "Q50";
    state.discs[0].comp[2] = "Q60";
    state.discs[0].track[3] = "Q50";
    // Q51 records none, and its two rows give it two different ones.
    state.discs[0].track[4] = "Q51";
    state.discs[0].comp[4] = "Q70";
    state.discs[0].track[5] = "Q51";
    state.discs[0].comp[5] = "Q71";
    stubWiki({ compositions: { Q50: ["Q60"] } });
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([
      "Disc 1 track 2 track, Disc 1 track 3 track: Q50 already records the composition Q60. Put Q60 in the track's composition field, so the track isn't given a second one.",
      "Disc 1 track 4 track, Disc 1 track 5 track: Q51 is used in more than one row with different compositions. Give each of those rows the same composition, so the track isn't given more than one.",
    ]);
    // The same composition in every row is fine.
    state.discs[0].comp[3] = "Q60";
    state.discs[0].comp[5] = "Q70";
    expect(await checkPlanQids(buildPlan(state).ops, state)).toEqual([]);
  });

  it("refuses a new item with the same label and description as a reused one", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.discs[0].comp[3] = "Q80";
    delete state.discs[0].comp[2];
    const plan = buildPlan(state);
    const comp = plan.ops.find((op) => op.op === "create" && op.key === "comp:0:2");
    if (comp?.op !== "create") throw new Error("no composition");
    const [title, desc] = [comp.labels.en, comp.descriptions.en];
    stubWiki({ classes: { Q80: ["Q105543609"] }, terms: { Q80: [title, desc] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([
      `The new composition “${title}” (disc 1 track 2) would have the same label and description as Q80 (Disc 1 track 3 composition), “${desc}”. ` +
        "Wikidata doesn't allow two items with the same label and description, so it would refuse to create it. Change the description of Q80 on Wikidata, or the composition description in Item settings.",
    ]);
    // A different description, or a different label, is fine.
    stubWiki({ classes: { Q80: ["Q105543609"] }, terms: { Q80: [title, `${desc} (song)`] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([]);
    stubWiki({ classes: { Q80: ["Q105543609"] }, terms: { Q80: [`${title} (song)`, desc] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([]);
    // With no English label, Wikidata pairs the English description with the mul label.
    stubWiki({ classes: { Q80: ["Q105543609"] }, terms: { Q80: [undefined, desc, title] } });
    expect(await checkPlanQids(plan.ops, state)).toHaveLength(1);
    // But not when there is an English label.
    stubWiki({
      classes: { Q80: ["Q105543609"] },
      terms: { Q80: [`${title} (song)`, desc, title] },
    });
    expect(await checkPlanQids(plan.ops, state)).toEqual([]);
  });

  it("takes a reused track's label and description from when its composition was checked", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.discs[0].track[2] = "Q81";
    delete state.discs[0].comp[2];
    const plan = buildPlan(state);
    const comp = plan.ops.find((op) => op.op === "create" && op.key === "comp:0:2");
    if (comp?.op !== "create") throw new Error("no composition");
    const fetch = stubWiki({ terms: { Q81: [comp.labels.en, comp.descriptions.en] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([
      expect.stringMatching(/would have the same label and description as Q81 /),
    ]);
    const asked = fetch.mock.calls
      .map(([url]) => new URL(url).searchParams)
      .filter((q) => q.get("props") === "labels|descriptions")
      .flatMap((q) => q.get("ids")!.split("|"));
    expect(asked).not.toContain("Q81");
  });

  it("refuses a new item with the same label and description as one in the mirror", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    delete state.discs[0].comp[2];
    const plan = buildPlan(state);
    const comp = plan.ops.find((op) => op.op === "create" && op.key === "comp:0:2");
    if (comp?.op !== "create") throw new Error("no composition");
    const [title, desc] = [comp.labels.en, comp.descriptions.en];
    findByTerms.mockResolvedValueOnce(["Q90"]);
    stubWiki({ terms: { Q90: [title, desc] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([
      `The new composition “${title}” (disc 1 track 2) would have the same label and description as Q90, “${desc}”. ` +
        "Wikidata doesn't allow two items with the same label and description, so it would refuse to create it. If Q90 is the same composition, use it in the form instead. If not, change its description on Wikidata, or the composition description in Item settings.",
    ]);
    expect(findByTerms).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ label: title, description: desc }]),
    );
    // What the mirror has is checked on Wikidata, where it may have changed since.
    findByTerms.mockResolvedValueOnce(["Q90"]);
    stubWiki({ terms: { Q90: [title, `${desc} (cover)`] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([]);
    // Without the mirror, the form's items are still checked.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    findByTerms.mockRejectedValueOnce(new Error("no database"));
    stubWiki({ terms: { Q90: [title, desc] } });
    expect(await checkPlanQids(plan.ops, state)).toEqual([]);
  });

  it("refuses two new items with the same label and description", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.album.title = "New";
    state.settings.trackDesc = state.settings.compDesc;
    delete state.discs[0].comp[2];
    const plan = buildPlan(state);
    const comp = plan.ops.find((op) => op.op === "create" && op.key === "comp:0:2");
    if (comp?.op !== "create") throw new Error("no composition");
    stubWiki({});
    expect(await checkPlanQids(plan.ops, state)).toContain(
      `The new composition “${comp.labels.en}” (disc 1 track 2) and the new track “${comp.labels.en}” (disc 1 track 2) would have the same label and description, “${comp.descriptions.en}”. ` +
        "Wikidata doesn't allow two items with the same label and description, so give them different descriptions in Item settings.",
    );
  });

  it("refuses an existing album that isn't an album or EP", async () => {
    stubWiki({ instanceOf: ["Q5"] });
    expect(await checkPlanQids(plan.ops, EXAMPLE)).toEqual([
      `The existing album: ${EXAMPLE.album.qid} is an instance of Q5, not an album or EP. Check the QID.`,
    ]);
    stubWiki({ instanceOf: [] });
    expect((await checkPlanQids(plan.ops, EXAMPLE))[0]).toMatch(/has no “instance of” statement/);
  });

  it("treats an id past the newest item as missing and checks the rest", async () => {
    const state = structuredClone(EXAMPLE);
    state.album.qid = "Q999999999999";
    const fetch = stubWiki({ tooBig: ["Q999999999999"] });
    const problems = await checkPlanQids(buildPlan(state).ops, state);
    expect(problems).toEqual(["The existing album: Q999999999999 doesn't exist."]);
    // Page info twice. Labels and descriptions aren't checked once something is wrong.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks in batches of 50, and doesn't ask again about items it found", async () => {
    const ops: Op[] = [
      {
        op: "create",
        key: "x",
        kind: "other",
        labels: {},
        descriptions: {},
        claims: Array.from({ length: 120 }, (_, i) => ({
          property: "P175",
          value: { type: "item" as const, id: `Q${i + 1}` },
        })),
      },
    ];
    const fetch = stubWiki({ missing: ["Q7"] });
    expect(await checkPlanQids(ops, EXAMPLE)).toEqual(["The performer value: Q7 doesn't exist."]);
    expect(fetch).toHaveBeenCalledTimes(3);
    // Only the missing one is asked about again.
    fetch.mockClear();
    await checkPlanQids(ops, EXAMPLE);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("ids")).toBe("Q7");
  });
});
