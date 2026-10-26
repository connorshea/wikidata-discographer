import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { checkPlanIds, IdCheckError, idsQuery, planIds, SPARQL_URL } from "./check-ids.ts";
import type { Op } from "../src/lib/plan.ts";

const mocks = vi.hoisted(() => ({
  upsertRows: vi.fn(async () => {}),
  getEntities: vi.fn(async (qids: readonly string[]) => new Map(qids.map((id) => [id, { id }]))),
}));
vi.mock("./mirror.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  entityToRow: (e: { id: string }) => ({ qid: e.id }),
  upsertRows: mocks.upsertRows,
}));
vi.mock("./wikidata-client.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEntities: mocks.getEntities,
}));

const RECORDING = "263340e1-2f03-4b31-b404-a06a8acda193";

const ops: Op[] = [
  {
    op: "create",
    key: "album",
    kind: "album",
    labels: { en: "Album" },
    descriptions: {},
    claims: [{ property: "P2205", value: { type: "string", value: "4aawyAB9vmqN3uQ7FjRGTy" } }],
  },
  {
    op: "create",
    key: "comp:0:1",
    kind: "work",
    labels: { en: "Intro" },
    descriptions: {},
    claims: [{ property: "P1827", value: { type: "string", value: "T-123.456.789-0" } }],
  },
  {
    op: "create",
    key: "track:0:1",
    kind: "track",
    labels: { en: "Intro" },
    descriptions: {},
    claims: [
      { property: "P175", value: { type: "item", id: "Q1" } },
      { property: "P4404", value: { type: "string", value: RECORDING } },
      { property: "P1243", value: { type: "string", value: "USUM71703861" } },
      { property: "P10110", value: { type: "string", value: "1065973702" } },
    ],
  },
  {
    op: "addClaims",
    target: { id: "Q2" },
    what: "track 1.2",
    claims: [{ property: "P4404", value: { type: "string", value: RECORDING } }],
  },
];

describe("planIds", () => {
  it("takes new items' identifiers, but not ISRCs, ISWCs or existing items'", () => {
    expect(planIds(ops).map((id) => [id.property, id.value, id.op.key])).toEqual([
      ["P2205", "4aawyAB9vmqN3uQ7FjRGTy", "album"],
      ["P4404", RECORDING, "track:0:1"],
      ["P10110", "1065973702", "track:0:1"],
    ]);
  });
});

describe("idsQuery", () => {
  it("has a VALUES row per identifier, with the value escaped", () => {
    const q = idsQuery([
      { property: "P4404", value: RECORDING },
      { property: "P2205", value: 'a"b\\c' },
    ]);
    expect(q).toContain(`(p:P4404 ps:P4404 "${RECORDING}")`);
    expect(q).toContain(String.raw`(p:P2205 ps:P2205 "a\"b\\c")`);
    expect(q).toContain("wikibase:DeprecatedRank");
  });
});

/** Answer the Query Service: `hits` are [qid, property, value], last updated `lagMs` ago. */
function stubSparql({
  hits = [],
  lagMs = 3_000,
  status = 200,
}: { hits?: [string, string, string][]; lagMs?: number | null; status?: number } = {}) {
  // The update time comes in a row of its own.
  const updated =
    lagMs === null
      ? []
      : [{ updated: { type: "literal", value: new Date(Date.now() - lagMs).toISOString() } }];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(SPARQL_URL);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
    if (status !== 200) return new Response("", { status });
    const bindings = [
      ...updated,
      ...hits.map(([q, p, v]) => ({
        item: { type: "uri", value: `http://www.wikidata.org/entity/${q}` },
        p: { type: "uri", value: `http://www.wikidata.org/prop/${p}` },
        value: { type: "literal", value: v },
      })),
    ];
    return Response.json({ results: { bindings } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("checkPlanIds", () => {
  beforeEach(() => {
    mocks.upsertRows.mockClear();
    vi.stubEnv("WIKIDATA_API_URL", "https://www.wikidata.org/w/api.php");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is empty when no item has the identifiers, in one request", async () => {
    const fetch = stubSparql();
    expect(await checkPlanIds(ops)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.upsertRows).not.toHaveBeenCalled();
  });

  it("names the items that already have them, and adds those to the mirror", async () => {
    stubSparql({
      hits: [
        ["Q10", "P4404", RECORDING],
        ["Q11", "P10110", "1065973702"],
        ["Q12", "P10110", "1065973702"],
        ["Q20", "P2205", "4aawyAB9vmqN3uQ7FjRGTy"],
      ],
    });
    expect(await checkPlanIds(ops)).toEqual([
      "The new album “Album” would get Spotify album ID 4aawyAB9vmqN3uQ7FjRGTy, but Q20 already has it. Use Q20 as the existing album instead, so it isn't created twice.",
      `The new track “Intro” (disc 1 track 1) would get MusicBrainz recording ID ${RECORDING}, but Q10 already has it. Put Q10 in that row's track field instead, so it isn't created twice.`,
      "The new track “Intro” (disc 1 track 1) would get Apple Music track ID 1065973702, but Q11 and Q12 already have it. If one of them is the same track, use it in the form instead. If not, fix the ID on Wikidata or run anyway.",
    ]);
    expect(mocks.upsertRows).toHaveBeenCalledWith(
      [{ qid: "Q10" }, { qid: "Q11" }, { qid: "Q12" }, { qid: "Q20" }],
      { source: "app" },
    );
  });

  it("asks nothing when no new item has an identifier", async () => {
    const fetch = stubSparql();
    expect(await checkPlanIds([ops[3]])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks nothing while the app edits test.wikidata.org", async () => {
    vi.stubEnv("WIKIDATA_API_URL", "https://test.wikidata.org/w/api.php");
    const fetch = stubSparql({ hits: [["Q10", "P4404", RECORDING]] });
    expect(await checkPlanIds(ops)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails when the Query Service is too far behind", async () => {
    stubSparql({ lagMs: 30 * 60_000 });
    await expect(checkPlanIds(ops)).rejects.toThrow(
      new IdCheckError("the Query Service is 30 minutes behind Wikidata"),
    );
  });

  it("fails when it doesn't say how far behind it is", async () => {
    stubSparql({ lagMs: null });
    await expect(checkPlanIds(ops)).rejects.toThrow(IdCheckError);
  });

  it("fails when the Query Service does, after trying twice more", async () => {
    vi.useFakeTimers();
    const fetch = stubSparql({ status: 503 });
    const check = expect(checkPlanIds(ops)).rejects.toThrow("the Query Service answered HTTP 503");
    await vi.runAllTimersAsync();
    await check;
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("tries again after a 5xx or a dropped connection", async () => {
    vi.useFakeTimers();
    const ok = stubSparql();
    const fetch = vi
      .fn<typeof ok>()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementation(ok);
    vi.stubGlobal("fetch", fetch);
    const check = checkPlanIds(ops);
    await vi.runAllTimersAsync();
    expect(await check).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("doesn't try again after a 4xx", async () => {
    const fetch = stubSparql({ status: 400 });
    await expect(checkPlanIds(ops)).rejects.toThrow("the Query Service answered HTTP 400");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
