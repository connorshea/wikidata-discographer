import { describe, expect, it } from "vite-plus/test";
import {
  dumpStamp,
  formatDuration,
  memoryNote,
  MirrorIndex,
  mightMatch,
  parseLine,
  progressLine,
  pruneProgressLine,
  readHeader,
} from "./dump-import.ts";
import { MIRROR_VERSION } from "./mirror.ts";

const line = (s: string) => Buffer.from(s);

describe("mightMatch", () => {
  it("keeps lines naming a music class", () => {
    expect(
      mightMatch(
        line('{"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":482994}}}}]}},'),
      ),
    ).toBe(true);
  });
  it("keeps a music class in any P31 statement, wherever P31 is", () => {
    const p31 =
      '"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":5}}}},' +
      '{"mainsnak":{"datavalue":{"value":{"numeric-id":482994}}}}]';
    expect(mightMatch(line(`{"claims":{"P17":[{"mainsnak":{}}],${p31}}},`))).toBe(true);
  });
  it("keeps lines with an artist identifier claim", () => {
    const p31 = '"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":5}}}}]';
    expect(mightMatch(line(`{"claims":{${p31},"P434":[{"mainsnak":{}}]}},`))).toBe(true);
    expect(mightMatch(line('{"claims":{"P1902":[{"mainsnak":{}}]}},'))).toBe(true);
  });
  it("skips everything else, including class numbers that only share a prefix", () => {
    const p31 = (id: number) => `"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":${id}}}}}]`;
    expect(mightMatch(line(`{"claims":{${p31(4829940)}}},`))).toBe(false);
    expect(mightMatch(line(`{"claims":{${p31(5)}}},`))).toBe(false);
    // A property number that only ends in an artist one, or is P31's prefix.
    expect(mightMatch(line('{"claims":{"P1434":[{"mainsnak":{}}],"P3":[{"mainsnak":{}}]}},'))).toBe(
      false,
    );
  });
  it("ignores music classes and artist ids outside P31 and the claims", () => {
    // A class as another property's value, and as a qualifier on P31.
    const claims =
      '"P361":[{"mainsnak":{"datavalue":{"value":{"numeric-id":482994}}}}],' +
      '"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":5}}}}]';
    expect(mightMatch(line(`{"claims":{${claims}}},`))).toBe(false);
    // An artist id property as a qualifier or reference: bare snaks, no mainsnak.
    const qualified =
      '"P31":[{"mainsnak":{"datavalue":{"value":{"numeric-id":5}}},' +
      '"qualifiers":{"P434":[{"snaktype":"value"}]}}]';
    expect(mightMatch(line(`{"claims":{${qualified}}},`))).toBe(false);
  });
});

describe("readHeader", () => {
  it("reads the id and lastrevid from the line's ends", () => {
    const claims = '"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"id":"Q5"}}}}]}';
    expect(
      readHeader(
        line(
          `{"type":"item","id":"Q31","labels":{},${claims},"title":"Q31",` +
            '"lastrevid":2548173641,"modified":"2026-09-21T16:13:48Z"},',
        ),
      ),
    ).toEqual({ qid: 31, revid: 2548173641 });
  });
  it("gives up on properties, brackets and lines without a revid", () => {
    // A nested item id further in mustn't be taken for the line's own.
    const nested = '"claims":{"P31":[{"mainsnak":{"datavalue":{"value":{"id":"Q5"}}}}]}';
    expect(readHeader(line(`{"type":"property","id":"P31",${nested},"lastrevid":7},`))).toBeNull();
    expect(readHeader(line("["))).toBeNull();
    expect(readHeader(line('{"type":"item","id":"Q1","labels":{}},'))).toBeNull();
  });
});

describe("MirrorIndex", () => {
  const index = new MirrorIndex([
    { qid: 3, revid: 300, rowVersion: MIRROR_VERSION - 1 },
    { qid: 9, revid: 400, rowVersion: MIRROR_VERSION },
    { qid: 10, revid: 500, rowVersion: MIRROR_VERSION },
    { qid: 200, revid: null, rowVersion: MIRROR_VERSION },
  ]);
  it("finds Q-numbers", () => {
    expect(index.find(10)).toBe(2);
    expect(index.find(11)).toBe(-1);
    // Past 2^32: the ids are 64-bit.
    const big = new MirrorIndex([{ qid: 2 ** 40, revid: 1, rowVersion: MIRROR_VERSION }]);
    expect(big.find(2 ** 40)).toBe(0);
  });
  it("needs rows in QID order", () => {
    expect(
      () =>
        new MirrorIndex([
          { qid: 10, revid: 1, rowVersion: MIRROR_VERSION },
          { qid: 9, revid: 1, rowVersion: MIRROR_VERSION },
        ]),
    ).toThrow("out of order");
  });
  it("skips only rows built from that revision or a later one, at this version", () => {
    expect(index.isCurrent(index.find(10), 500)).toBe(true);
    expect(index.isCurrent(index.find(10), 499)).toBe(true);
    expect(index.isCurrent(index.find(10), 501)).toBe(false);
    // Unknown revid, or written by an older MIRROR_VERSION: always re-read.
    expect(index.isCurrent(index.find(200), 1)).toBe(false);
    expect(index.isCurrent(index.find(3), 300)).toBe(false);
  });
  it("lists the QIDs not seen", () => {
    const fresh = new MirrorIndex([
      { qid: 1, revid: 1, rowVersion: MIRROR_VERSION },
      { qid: 2, revid: 1, rowVersion: MIRROR_VERSION },
    ]);
    fresh.seen[fresh.find(2)] = 1;
    expect(fresh.unseen()).toEqual([1]);
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
  const stats = { bytes: 412e9, lines: 29_500_000, unchanged: 270_000, matched: 10_123 };
  it("shows the share of the file read, the time left and the rate so far", () => {
    // A quarter of the file in 1 hour leaves 3 hours; 412 GB in 3600 s is 114 MB/s.
    expect(progressLine(stats, 25, 100, 3_600_000)).toBe(
      "import-dump: 25.0%, ETA 3h 00m — 412.0 GB at 114 MB/s, 29500000 lines, " +
        "270000 unchanged, 10123 new or changed",
    );
  });
  it("leaves out the estimate before anything is read", () => {
    expect(progressLine(stats, 0, 100, 0)).toBe(
      "import-dump: 412.0 GB, 29500000 lines, 270000 unchanged, 10123 new or changed",
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
