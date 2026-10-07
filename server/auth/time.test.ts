import { describe, expect, it } from "vite-plus/test";
import { registrationToSql } from "./time.ts";

describe("registrationToSql", () => {
  it("reads MediaWiki's 14-digit timestamps as UTC", () => {
    expect(registrationToSql("20240131235959")).toBe("2024-01-31 23:59:59");
  });

  it("reads ISO timestamps", () => {
    expect(registrationToSql("2024-01-31T23:59:59Z")).toBe("2024-01-31 23:59:59");
  });

  it("treats a missing or unreadable registration as none", () => {
    expect(registrationToSql(undefined)).toBeNull();
    expect(registrationToSql(null)).toBeNull();
    expect(registrationToSql(false)).toBeNull();
    expect(registrationToSql("")).toBeNull();
    expect(registrationToSql("not a date")).toBeNull();
    expect(registrationToSql("20241399000000")).toBeNull();
  });
});
