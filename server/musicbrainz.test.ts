import { describe, expect, it, vi } from "vite-plus/test";
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

  it("lists a release group's official releases a page at a time", async () => {
    const page = (n: number, total: number) => () =>
      Response.json({
        releases: Array.from({ length: n }, (_, i) => ({ id: `r${i}` })),
        "release-count": total,
      });
    const { client, calls } = fakeClient([page(100, 150), page(50, 150), ok("A")]);
    const group = await client.releaseGroup(ID);
    expect(group.total).toBe(150);
    expect(group.releases).toHaveLength(150);
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "100"]);
    expect(calls[0].url).toContain(`release-group=${ID}&status=official&inc=media`);
    // Cached apart from the release with the same ID.
    expect(await client.release(ID)).toMatchObject({ title: "A" });
    await client.releaseGroup(ID);
    expect(calls).toHaveLength(3);
  });

  it("stops after three pages, and lists every release when none are official", async () => {
    const page = (total: number) => () =>
      Response.json({ releases: total ? [{ id: "r" }] : [], "release-count": total });
    const big = fakeClient([page(1000), page(1000), page(1000)]);
    expect((await big.client.releaseGroup(ID)).releases).toHaveLength(3);
    const bootlegs = fakeClient([page(0), page(1)]);
    expect(await bootlegs.client.releaseGroup(ID)).toMatchObject({ total: 1 });
    expect(bootlegs.calls[1].url).not.toContain("status=");
  });

  it("never starts two requests less than 1.1 s apart, pages and retries included", async () => {
    // Real timers' code (setTimeout, Date.now) on a fake clock, so waits overlap as they would.
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const client = createMusicBrainzClient({
        fetch: async (url) => {
          starts.push(Date.now());
          await new Promise((resolve) => setTimeout(resolve, 50)); // the request itself
          if (starts.length === 2)
            return new Response("", { status: 503, headers: { "Retry-After": "1" } });
          return (url as string).includes("release-group")
            ? Response.json({ releases: [{ id: "r" }], "release-count": 3 })
            : Response.json({ id: ID });
        },
      });
      const done = Promise.all([
        client.releaseGroup(ID),
        client.release(ID.replace("6d", "7d")),
        client.release(ID.replace("6d", "8d")),
      ]);
      await vi.runAllTimersAsync();
      await done;
      // Three pages, two releases and one retry.
      expect(starts).toHaveLength(6);
      for (let i = 1; i < starts.length; i++)
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when there's no such release", async () => {
    const { client } = fakeClient([status(404)]);
    const err = await client.release(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MusicBrainzError);
    expect(err).toMatchObject({
      status: 404,
      message: expect.stringMatching(/^MusicBrainz has no release with that ID\./),
    });
  });
});
