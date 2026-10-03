import { describe, expect, it } from "vite-plus/test";
import {
  dumpStamp,
  formatDuration,
  memoryNote,
  mightMatch,
  parseLine,
  progressLine,
  pruneProgressLine,
} from "./dump-import.ts";

const line = (s: string) => Buffer.from(s);

describe("mightMatch", () => {
  it("keeps lines naming a music class", () => {
    expect(
      mightMatch(
        line('{"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":482994}}}}]}},'),
      ),
    ).toBe(true);
  });
  it("keeps lines with an artist identifier claim", () => {
    expect(
      mightMatch(line('{"claims":{"P31":[{"numeric-id":5}],"P434":[{"mainsnak":{}}]}},')),
    ).toBe(true);
  });
  it("skips everything else, including class numbers that only share a prefix", () => {
    expect(mightMatch(line('{"claims":{"P31":[{"numeric-id":4829940}]}},'))).toBe(false);
    expect(mightMatch(line('{"claims":{"P31":[{"numeric-id":5}]}},'))).toBe(false);
  });
});

describe("parseLine", () => {
  it("parses an entity line and ignores the brackets", () => {
    expect(parseLine(line('{"id":"Q1","type":"item"},\r'))).toEqual({ id: "Q1", type: "item" });
    expect(parseLine(line('{"id":"Q2"}'))).toEqual({ id: "Q2" });
    expect(parseLine(line("["))).toBeNull();
    expect(parseLine(line("]"))).toBeNull();
  });
});

describe("dumpStamp", () => {
  it("reads the date from the file name, else uses today", () => {
    expect(dumpStamp("/dumps/20260930/wikidata-20260930-all.json.gz")).toBe("20260930");
    expect(dumpStamp("/dumps/latest-all.json.gz", new Date("2026-10-03T12:00:00Z"))).toBe(
      "20261003",
    );
  });
});

describe("progressLine", () => {
  const stats = { bytes: 412e9, lines: 29_500_000, matched: 280_123 };
  it("shows the share of the file read and the time left at the rate so far", () => {
    // A quarter of the file in 1 hour leaves 3 hours.
    expect(progressLine(stats, 25, 100, 3_600_000)).toBe(
      "import-dump: 25.0%, ETA 3h 00m — 412.0 GB, 29500000 lines, 280123 matched",
    );
  });
  it("leaves out the estimate before anything is read", () => {
    expect(progressLine(stats, 0, 100, 1000)).toBe(
      "import-dump: 412.0 GB, 29500000 lines, 280123 matched",
    );
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(30_000)).toBe("<1m");
    expect(formatDuration(14 * 60_000)).toBe("14m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
  });
});

describe("pruneProgressLine", () => {
  it("shows how many are pruned and the time left", () => {
    expect(pruneProgressLine(15_000, 60_000, 120_000)).toBe(
      "import-dump: pruned 15000 of 60000 (25.0%, ETA 6m)",
    );
    expect(pruneProgressLine(0, 60_000, 1000)).toBe("import-dump: pruned 0 of 60000 (0.0%)");
  });
});

describe("memoryNote", () => {
  it("shows RSS, heap and external use in MB", () => {
    const mem = {
      rss: 312e6,
      heapUsed: 120.4e6,
      heapTotal: 160e6,
      external: 45.6e6,
      arrayBuffers: 40e6,
    };
    expect(memoryNote(mem)).toBe(" [rss 312 MB, heap 120/160 MB, external 46 MB (buffers 40 MB)]");
  });
});
