import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getEntities, WikidataEditError } from "./wikidata-client.ts";

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
