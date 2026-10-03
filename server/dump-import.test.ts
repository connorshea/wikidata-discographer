import { describe, expect, it } from "vite-plus/test";
import { dumpStamp, mightMatch, parseLine } from "./dump-import.ts";

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
