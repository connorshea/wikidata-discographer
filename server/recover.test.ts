import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { findCreated, type PendingCreate, waitForCreated } from "./recover.ts";

const summary =
  "Create track “Intro” (Wikidata Discographer) ([[:toolforge:editgroups/b/CB/0123456789abcdef|details]])";
const pending: PendingCreate = {
  username: "Example",
  summary,
  labels: { en: "Intro" },
  startedAt: new Date("2026-10-03T20:00:00Z"),
};

const contrib = (title: string, comment = `/* wbeditentity-create-item:0| */ ${summary}`) => ({
  title,
  timestamp: "2026-10-03T20:00:20Z",
  comment,
});
const item = (id: string, label = "Intro") => ({
  id,
  lastrevid: 7,
  labels: { en: { language: "en", value: label } },
  claims: {},
});

/** Answer usercontribs with `contribs()` and wbgetentities with `items`. */
function stubWiki(contribs: () => ReturnType<typeof contrib>[], items: ReturnType<typeof item>[]) {
  const fetch = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get("list") === "usercontribs") {
      expect(q.get("ucuser")).toBe("Example");
      expect(q.get("ucshow")).toBe("new");
      expect(q.get("ucnamespace")).toBe("0");
      expect(q.get("ucdir")).toBe("newer");
      return Response.json({ query: { usercontribs: contribs() } });
    }
    const ids = q.get("ids")!.split("|");
    return Response.json({
      entities: Object.fromEntries(items.filter((e) => ids.includes(e.id)).map((e) => [e.id, e])),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("findCreated", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finds the item by its summary and label", async () => {
    stubWiki(() => [contrib("Q5")], [item("Q5")]);
    expect((await findCreated(pending)).map((e) => e.id)).toEqual(["Q5"]);
  });

  it("ignores items with another summary, another label, or already known", async () => {
    const otherRun = summary.replace("0123456789abcdef", "fedcba9876543210");
    stubWiki(
      () => [contrib("Q1", otherRun), contrib("Q2"), contrib("Q3")],
      [item("Q1"), item("Q2", "Outro"), item("Q3")],
    );
    expect(await findCreated({ ...pending, exclude: new Set(["Q3"]) })).toEqual([]);
  });

  it("returns every match, so two aren't mistaken for one", async () => {
    stubWiki(() => [contrib("Q5"), contrib("Q6")], [item("Q5"), item("Q6")]);
    expect((await findCreated(pending)).map((e) => e.id)).toEqual(["Q5", "Q6"]);
  });
});

describe("waitForCreated", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-03T20:01:30Z") }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps looking until the replicas show the item", async () => {
    let looks = 0;
    const fetch = stubWiki(() => (++looks < 3 ? [] : [contrib("Q5")]), [item("Q5")]);
    const found = waitForCreated(pending, new Date());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(looks).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await found).map((e) => e.id)).toEqual(["Q5"]);
    // No create is ever sent: only reads.
    for (const [url] of fetch.mock.calls) expect(new URL(url).searchParams.get("new")).toBeNull();
  });

  it("gives up after two minutes when nothing turns up", async () => {
    let looks = 0;
    stubWiki(() => (looks++, []), []);
    const found = waitForCreated(pending, new Date());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await found).toEqual([]);
    expect(looks).toBe(4);
  });

  it("carries on past a look that fails", async () => {
    let looks = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubWiki(() => {
      if (++looks === 1) throw new Error("boom");
      return [contrib("Q5")];
    }, [item("Q5")]);
    const found = waitForCreated(pending, new Date());
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await found).map((e) => e.id)).toEqual(["Q5"]);
  });
});
