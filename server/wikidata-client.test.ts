import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  describeItems,
  editRequest,
  freshStatements,
  getEntities,
  toStatement,
  WikidataEditError,
} from "./wikidata-client.ts";

vi.mock("./auth/tokens.ts", () => ({
  getAccessToken: async () => "access",
  deleteTokens: async () => {},
  TokenError: class extends Error {},
}));

const entity = { id: "Q1", claims: {} };
const ok = () => Response.json({ entities: { Q1: entity } });
const limited = () => new Response("", { status: 429, headers: { "Retry-After": "2" } });

describe("getEntities retries", () => {
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits out a 429 as Retry-After asks, then reads", async () => {
    fetch.mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok());
    const got = getEntities(["Q1"]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await got).get("Q1")).toEqual(entity);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx and a network failure with backoff", async () => {
    fetch
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    const got = getEntities(["Q1"]);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000);
    expect((await got).get("Q1")).toEqual(entity);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries, with the last error", async () => {
    fetch.mockImplementation(async () => new Response("", { status: 503 }));
    const got = getEntities(["Q1"]).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 45_000);
    const err = await got;
    expect(err).toBeInstanceOf(WikidataEditError);
    expect((err as WikidataEditError).code).toBe("http-503");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("doesn't retry when told not to, or on an error that won't pass", async () => {
    fetch.mockResolvedValueOnce(limited());
    await expect(getEntities(["Q1"], { retries: 0 })).rejects.toMatchObject({ code: "http-429" });
    fetch.mockResolvedValueOnce(
      Response.json({ errors: [{ code: "no-such-entity", text: "Could not find Q1" }] }),
    );
    await expect(getEntities(["Q1"])).rejects.toMatchObject({ code: "no-such-entity" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("editRequest", () => {
  const user = { id: 1, username: "Example" };
  const csrf = () => Response.json({ query: { tokens: { csrftoken: "tok+\\" } } });
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks a 5xx after sending as ambiguous, and doesn't send it again", async () => {
    fetch.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(new Response("", { status: 504 }));
    const err = await editRequest(user, { action: "wbeditentity", new: "item" }).catch((e) => e);
    expect(err).toMatchObject({ code: "http-504", ambiguous: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("marks a timeout or dropped connection as ambiguous", async () => {
    fetch
      .mockResolvedValueOnce(csrf())
      .mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    const err = await editRequest(user, { action: "wbeditentity", new: "item" }).catch((e) => e);
    expect(err).toMatchObject({ code: "network", ambiguous: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't mark a refusal or a failure before sending as ambiguous", async () => {
    fetch
      .mockResolvedValueOnce(csrf())
      .mockResolvedValueOnce(
        Response.json({ errors: [{ code: "modification-failed", text: "Label taken" }] }),
      );
    await expect(editRequest(user, { action: "wbeditentity" })).rejects.toMatchObject({
      code: "modification-failed",
      ambiguous: false,
    });
    // The CSRF token read retries, then fails before anything is sent.
    vi.useFakeTimers();
    fetch.mockImplementation(async () => new Response("", { status: 503 }));
    const err = editRequest(user, { action: "wbeditentity" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 45_000);
    expect(await err).toMatchObject({ ambiguous: false });
    vi.useRealTimers();
  });
});

describe("describeItems", () => {
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const p31 = (id: string, rank = "normal") => ({
    rank,
    mainsnak: {
      snaktype: "value",
      property: "P31",
      datavalue: { type: "wikibase-entityid", value: { id } },
    },
  });

  it("reads labels, descriptions and classes in one request", async () => {
    fetch.mockResolvedValueOnce(
      Response.json({
        entities: {
          Q1: {
            id: "Q1",
            labels: { en: { language: "en", value: "Anna Sun" } },
            descriptions: { en: { language: "en", value: "single by Walk the Moon" } },
            claims: { P31: [p31("Q134556"), p31("Q5", "deprecated")] },
          },
          Q2: { id: "Q3", redirects: { from: "Q2", to: "Q3" }, claims: {} },
          Q4: { id: "Q4", missing: "" },
        },
      }),
    );
    const got = await describeItems(["Q1", "Q2", "Q4", "Q1"], "en");
    expect(Object.fromEntries(got)).toEqual({
      Q1: {
        status: "ok",
        label: "Anna Sun",
        description: "single by Walk the Moon",
        classes: ["Q134556"],
      },
      Q2: { status: "redirect", to: "Q3" },
      Q4: { status: "missing" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("ids")).toBe("Q1|Q2|Q4");
    expect(url.searchParams.get("languages")).toBe("en");
  });

  it("marks an id past the newest item missing and asks again for the rest", async () => {
    fetch
      .mockResolvedValueOnce(
        Response.json({ errors: [{ code: "no-such-entity", data: { id: "Q999999999" } }] }),
      )
      .mockResolvedValueOnce(Response.json({ entities: { Q1: { id: "Q1", claims: {} } } }));
    const got = await describeItems(["Q1", "Q999999999"], "en");
    expect(got.get("Q999999999")).toEqual({ status: "missing" });
    expect(got.get("Q1")).toEqual({ status: "ok", label: null, description: null, classes: [] });
  });
});

describe("freshStatements", () => {
  const count = (amount: number) => ({
    mainsnak: {
      snaktype: "value",
      property: "P2635",
      datavalue: { type: "quantity", value: { amount: `+${amount}`, unit: "1" } },
    },
  });
  const tracklist = { property: "P658", value: { type: "item" as const, id: "Q5" } };
  const resolve = (ref: string) => ref;

  it("skips an ifMissing claim when the item has the property with any value", () => {
    const claims = [
      tracklist,
      {
        property: "P2635",
        value: { type: "quantity" as const, amount: 3 },
        ifMissing: true as const,
      },
    ];
    expect(
      freshStatements({ P2635: [count(12)] }, claims, resolve).map((s) => s.mainsnak.property),
    ).toEqual(["P658"]);
    expect(freshStatements({}, claims, resolve).map((s) => s.mainsnak.property)).toEqual([
      "P658",
      "P2635",
    ]);
  });

  it("skips a plain claim only when the item has that same value", () => {
    const claim = { property: "P2635", value: { type: "quantity" as const, amount: 3 } };
    expect(freshStatements({ P2635: [count(3)] }, [claim], resolve)).toEqual([]);
    expect(freshStatements({ P2635: [count(12)] }, [claim], resolve)).toHaveLength(1);
  });
});

describe("toStatement", () => {
  it("writes references as Wikibase snak groups, with created items resolved", () => {
    const statement = toStatement(
      {
        property: "P2047",
        value: { type: "quantity", amount: 177, unit: "Q11574" },
        references: [
          [
            { property: "P248", value: { type: "item", ref: "source" } },
            { property: "P4404", value: { type: "string", value: "abc" } },
            {
              property: "P813",
              value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
            },
          ],
        ],
      },
      (ref) => (ref === "source" ? "Q14005" : ref),
    );
    expect(statement.references).toEqual([
      {
        "snaks-order": ["P248", "P4404", "P813"],
        snaks: {
          P248: [
            {
              snaktype: "value",
              property: "P248",
              datavalue: {
                type: "wikibase-entityid",
                value: { "entity-type": "item", id: "Q14005" },
              },
            },
          ],
          P4404: [
            {
              snaktype: "value",
              property: "P4404",
              datavalue: { type: "string", value: "abc" },
            },
          ],
          P813: [expect.objectContaining({ property: "P813" })],
        },
      },
    ]);
    expect(
      toStatement({ property: "P31", value: { type: "item", id: "Q5" } }, (r) => r),
    ).not.toHaveProperty("references");
  });
});
