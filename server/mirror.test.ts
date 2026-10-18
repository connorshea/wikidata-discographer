import { describe, expect, it } from "vite-plus/test";
import { dateText, entityToRow } from "./mirror.ts";
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
    expect(entityToRow({ ...entity, lastrevid: 2548173641 })).toEqual({
      qid: "Q140316456",
      revid: 2548173641,
      kind: "album",
      label: "Day and Night",
      description: "2026 album",
      instanceOf: ["Q482994"],
      released: null,
      parts: null,
      // In ID_PROPERTIES order, duplicates and deprecated values dropped.
      ids: [
        { property: "P436", value: "mbid" },
        { property: "P2205", value: "abc" },
      ],
      links: [],
    });
  });

  it("keeps item links, without duplicates or deprecated ones", () => {
    const link = (property: string, id: string, rank: WikibaseStatement["rank"] = "normal") =>
      ({ ...item(id, rank), mainsnak: { ...item(id).mainsnak, property } }) as WikibaseStatement;
    const entity = {
      id: "Q10",
      claims: {
        P31: [item("Q55850593")],
        P175: [link("P175", "Q52583"), link("P175", "Q52583"), link("P175", "Q1", "deprecated")],
        P2550: [link("P2550", "Q20")],
        P17: [link("P17", "Q30")],
      },
    } as Entity;
    expect(entityToRow(entity)?.links).toEqual([
      { property: "P175", target: "Q52583" },
      { property: "P2550", target: "Q20" },
    ]);
  });

  it("keeps the earliest release date and the number of parts", () => {
    const time = (t: string, precision: number, rank: WikibaseStatement["rank"] = "normal") =>
      ({
        rank,
        mainsnak: {
          snaktype: "value",
          property: "P577",
          datavalue: { type: "time", value: { time: t, precision } },
        },
      }) as WikibaseStatement;
    const entity = {
      id: "Q1",
      claims: {
        P31: [item("Q482994")],
        P577: [
          time("+2009-07-14T00:00:00Z", 11),
          time("+2009-00-00T00:00:00Z", 9),
          time("+2001-01-01T00:00:00Z", 11, "deprecated"),
        ],
        P2635: [
          {
            rank: "normal",
            mainsnak: {
              snaktype: "value",
              property: "P2635",
              datavalue: { type: "quantity", value: { amount: "+12", unit: "1" } },
            },
          } as WikibaseStatement,
        ],
      },
    } as Entity;
    expect(entityToRow(entity)).toMatchObject({ released: "2009", parts: 12 });
  });

  it("formats a date by its precision", () => {
    expect(dateText({ time: "+2009-07-14T00:00:00Z", precision: 11 })).toBe("2009-07-14");
    expect(dateText({ time: "+2009-07-14T00:00:00Z", precision: 10 })).toBe("2009-07");
    expect(dateText({ time: "+2009-07-00T00:00:00Z", precision: 11 })).toBe("2009-07");
    expect(dateText({ time: "+2009-00-00T00:00:00Z", precision: 9 })).toBe("2009");
    expect(dateText({ time: "+2000-00-00T00:00:00Z", precision: 8 })).toBeNull();
    expect(dateText({ time: "-0500-00-00T00:00:00Z", precision: 9 })).toBeNull();
    expect(dateText("2009")).toBeNull();
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
