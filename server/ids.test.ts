import { describe, expect, it } from "vite-plus/test";
import { propertyNumber, qidNumber, toProperty, toQid } from "./ids.ts";

describe("ids", () => {
  it("converts item and property IDs both ways", () => {
    expect(qidNumber("Q140316456")).toBe(140316456);
    expect(toQid(140316456)).toBe("Q140316456");
    expect(propertyNumber("P2205")).toBe(2205);
    expect(toProperty(2205)).toBe("P2205");
  });
  it("refuses anything else", () => {
    expect(() => qidNumber("P31")).toThrow("Not an item ID");
    expect(() => qidNumber("q5")).toThrow();
    expect(() => propertyNumber("Q5")).toThrow("Not a property ID");
  });
});
