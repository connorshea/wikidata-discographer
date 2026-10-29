import { describe, expect, it } from "vite-plus/test";
import { addViewed, loadViewed, mergeRecent, parseViewed, RECENT_SHOWN } from "./recent-artists.ts";

/** A Storage backed by a Map. */
function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("parseViewed", () => {
  it("keeps only well-formed artists", () => {
    const raw = JSON.stringify([
      { qid: "Q1", label: "Owl City", at: "2026-10-27T10:00:00.000Z" },
      { qid: "Q2", label: null, at: "2026-10-26T10:00:00.000Z" },
      { qid: "nope", label: "x", at: "2026-10-26T10:00:00.000Z" },
      { qid: "Q3", label: "x", at: "not a date" },
      null,
    ]);
    expect(parseViewed(raw).map((v) => v.qid)).toEqual(["Q1", "Q2"]);
  });

  it("is empty for nothing, or not a list", () => {
    expect(parseViewed(null)).toEqual([]);
    expect(parseViewed("{")).toEqual([]);
    expect(parseViewed('{"qid":"Q1"}')).toEqual([]);
  });
});

describe("addViewed", () => {
  it("puts the artist first, once", () => {
    const store = memoryStore();
    addViewed({ qid: "Q1", label: "A" }, new Date("2026-10-26T00:00:00Z"), store);
    addViewed({ qid: "Q2", label: "B" }, new Date("2026-10-27T00:00:00Z"), store);
    addViewed({ qid: "Q1", label: "A" }, new Date("2026-10-28T00:00:00Z"), store);
    expect(loadViewed(store)).toEqual([
      { qid: "Q1", label: "A", at: "2026-10-28T00:00:00.000Z" },
      { qid: "Q2", label: "B", at: "2026-10-27T00:00:00.000Z" },
    ]);
  });

  it("keeps at most RECENT_SHOWN", () => {
    const store = memoryStore();
    for (let i = 1; i <= RECENT_SHOWN + 3; i++)
      addViewed({ qid: `Q${i}`, label: null }, new Date(), store);
    expect(loadViewed(store)).toHaveLength(RECENT_SHOWN);
    expect(loadViewed(store)[0].qid).toBe(`Q${RECENT_SHOWN + 3}`);
  });

  it("does nothing when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => addViewed({ qid: "Q1", label: null }, new Date(), blocked)).not.toThrow();
    expect(loadViewed(blocked)).toEqual([]);
  });
});

describe("mergeRecent", () => {
  const album = { qid: "Q10", label: "Day and Night" };

  it("puts viewed and edited artists in one list, newest first, each once", () => {
    const got = mergeRecent(
      [
        { qid: "Q1", label: "Owl City", at: "2026-10-28T09:00:00.000Z" },
        { qid: "Q3", label: "The Script", at: "2026-10-26T09:00:00.000Z" },
        { qid: "Q2", label: "Carly Rae Jepsen", at: "2026-10-20T09:00:00.000Z" },
      ],
      [{ qid: "Q2", label: "Carly Rae Jepsen", album, at: "2026-10-27 09:00:00" }],
    );
    expect(got.map((r) => [r.qid, r.album?.label ?? null])).toEqual([
      ["Q1", null],
      ["Q2", "Day and Night"],
      ["Q3", null],
    ]);
    expect(got[1].at).toBe(Date.parse("2026-10-27T09:00:00Z"));
  });

  it("keeps at most RECENT_SHOWN", () => {
    const viewed = Array.from({ length: RECENT_SHOWN + 2 }, (_, i) => ({
      qid: `Q${i + 1}`,
      label: null,
      at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
    }));
    expect(mergeRecent(viewed, [])).toHaveLength(RECENT_SHOWN);
  });
});
