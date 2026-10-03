import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkPlanQids, forgetCheckedQids, planQids } from "./check-qids.ts";
import { buildPlan, type Op } from "../src/lib/plan.ts";
import { EXAMPLE } from "../src/lib/state.ts";

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
}: {
  missing?: string[];
  redirects?: Record<string, string>;
  tooBig?: string[];
  /** The album's P31 values. */
  instanceOf?: string[];
}) {
  const fetch = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get("action") === "wbgetclaims") {
      expect(q.get("property")).toBe("P31");
      return Response.json({
        claims: {
          P31: instanceOf.map((id) => ({
            mainsnak: { snaktype: "value", property: "P31", datavalue: { value: { id } } },
            rank: "normal",
          })),
        },
      });
    }
    expect(q.get("action")).toBe("wbgetentities");
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

  it("fetches only the existing album's “instance of” statements", async () => {
    const fetch = stubWiki({ instanceOf: ["Q208569"] });
    expect(await checkPlanQids(plan.ops, EXAMPLE)).toEqual([]);
    const claims = fetch.mock.calls.filter(
      ([url]) => new URL(url).searchParams.get("action") === "wbgetclaims",
    );
    expect(claims.map(([url]) => new URL(url).searchParams.get("entity"))).toEqual([
      EXAMPLE.album.qid,
    ]);
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
