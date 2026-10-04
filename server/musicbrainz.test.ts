import { describe, expect, it } from "vite-plus/test";
import { createMusicBrainzClient, MusicBrainzError } from "./musicbrainz.ts";
import { userAgent } from "./auth/user-agent.ts";

const ID = "6d42c8a3-69c3-458c-9f18-f8a503780607";

/** A client on a fake clock, answering with `responses` in turn. */
function fakeClient(responses: (() => Response)[], cacheMs = 60_000) {
  let clock = 1_000_000;
  const calls: { url: string; agent: string | null }[] = [];
  const sleeps: number[] = [];
  const client = createMusicBrainzClient({
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetch: async (url, init) => {
      calls.push({
        url: url as string,
        agent: new Headers(init?.headers).get("User-Agent"),
      });
      return responses.shift()!();
    },
    gapMs: 1100,
    cacheMs,
  });
  return { client, calls, sleeps, tick: (ms: number) => (clock += ms) };
}

const ok = (title: string) => () => Response.json({ id: ID, title });
const status = (n: number, headers?: Record<string, string>) => () =>
  new Response("", { status: n, headers });

describe("createMusicBrainzClient", () => {
  it("asks for the release with everything the form needs, as this app", async () => {
    const { client, calls } = fakeClient([ok("Day and Night")]);
    expect(await client.release(ID)).toMatchObject({ title: "Day and Night" });
    expect(calls[0].url).toMatch(new RegExp(`/release/${ID}\\?inc=recordings\\+artist-credits`));
    expect(calls[0].url).toContain("release-group-level-rels");
    expect(calls[0].agent).toBe(userAgent());
  });

  it("keeps requests a gap apart, and caches releases", async () => {
    const other = ID.replace("6d", "7d");
    const { client, calls, sleeps, tick } = fakeClient([ok("A"), ok("B"), ok("C")], 5000);
    await Promise.all([client.release(ID), client.release(other)]);
    expect(sleeps).toEqual([1100]);
    await client.release(ID);
    expect(calls).toHaveLength(2);
    tick(5000);
    expect(await client.release(ID)).toMatchObject({ title: "C" });
  });

  it("retries a 503 after its Retry-After, then gives up", async () => {
    const { client, sleeps } = fakeClient([status(503, { "Retry-After": "3" }), ok("A")]);
    expect(await client.release(ID)).toMatchObject({ title: "A" });
    expect(sleeps).toContain(3000);

    const busy = fakeClient([status(503), status(503), status(503)]).client;
    await expect(busy.release(ID)).rejects.toThrow("MusicBrainz is busy");
  });

  it("says when there's no such release", async () => {
    const { client } = fakeClient([status(404)]);
    const err = await client.release(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MusicBrainzError);
    expect(err).toMatchObject({ status: 404, message: "MusicBrainz has no release with that ID." });
  });
});
