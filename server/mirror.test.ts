import { describe, expect, it } from "vite-plus/test";
import { entityToRow, labelSearchKey } from "./mirror.ts";
import type { Entity, WikibaseStatement } from "./wikidata-client.ts";

const item = (id: string, rank: WikibaseStatement["rank"] = "normal"): WikibaseStatement =>
  ({
    rank,
    mainsnak: {
      snaktype: "value",
      property: "P31",
      datavalue: { type: "wikibase-entityid", value: { id } },
    },
  }) as WikibaseStatement;
const ext = (value: string, rank: WikibaseStatement["rank"] = "normal"): WikibaseStatement =>
  ({
    rank,
    mainsnak: { snaktype: "value", property: "P", datavalue: { type: "string", value } },
  }) as WikibaseStatement;

describe("entityToRow", () => {
  it("converts an album with its identifiers", () => {
    const entity: Entity = {
      id: "Q140316456",
      labels: {
        fr: { language: "fr", value: "Jour" },
        en: { language: "en", value: "Day and Night" },
      },
      descriptions: { en: { language: "en", value: "2026 album" } },
      claims: {
        P31: [item("Q482994")],
        P2205: [ext("abc"), ext("abc"), ext("old", "deprecated")],
        P436: [ext("mbid")],
      },
    } as Entity;
    expect(entityToRow(entity)).toEqual({
      qid: "Q140316456",
      kind: "album",
      label: "Day and Night",
      description: "2026 album",
      instanceOf: ["Q482994"],
      // In ID_PROPERTIES order, duplicates and deprecated values dropped.
      ids: [
        { property: "P436", value: "mbid" },
        { property: "P2205", value: "abc" },
      ],
    });
  });

  it("uses only the preferred P31 when there is one", () => {
    const entity = {
      id: "Q1",
      claims: { P31: [item("Q482994"), item("Q5", "preferred")] },
    } as Entity;
    expect(entityToRow(entity)).toBeNull();
  });

  it("keeps a person with an artist identifier", () => {
    const entity = {
      id: "Q52583",
      claims: { P31: [item("Q5")], P434: [ext("mb-artist")] },
    } as Entity;
    expect(entityToRow(entity)).toMatchObject({
      kind: "artist",
      ids: [{ property: "P434", value: "mb-artist" }],
    });
  });

  it("skips non-items", () => {
    expect(entityToRow({ id: "P31", claims: { P31: [item("Q482994")] } } as Entity)).toBeNull();
  });
});

describe("labelSearchKey", () => {
  it("lowercases and clips to the index length", () => {
    expect(labelSearchKey("ABC")).toBe("abc");
    expect(labelSearchKey("x".repeat(300))).toHaveLength(191);
    expect(labelSearchKey(null)).toBeNull();
  });
});
