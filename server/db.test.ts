import { describe, expect, it, vi } from "vite-plus/test";
import { isLockConflict, retryOnLockConflict } from "./db.ts";

const deadlock = () => Object.assign(new Error("Deadlock found"), { errno: 1213 });

describe("isLockConflict", () => {
  it("spots deadlocks and lock timeouts, also under Drizzle's wrapper", () => {
    expect(isLockConflict(deadlock())).toBe(true);
    expect(isLockConflict(new Error("Failed query", { cause: { errno: 1205 } }))).toBe(true);
    expect(isLockConflict(Object.assign(new Error("dup"), { errno: 1062 }))).toBe(false);
    expect(isLockConflict(undefined)).toBe(false);
  });
});

describe("retryOnLockConflict", () => {
  it("runs the transaction again after a lock conflict", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce("ok");
    await expect(retryOnLockConflict("test", fn, { waitMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("gives up after the retries, and never retries other errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stuck = vi.fn().mockRejectedValue(deadlock());
    await expect(retryOnLockConflict("test", stuck, { retries: 2, waitMs: 1 })).rejects.toThrow(
      "Deadlock",
    );
    expect(stuck).toHaveBeenCalledTimes(3);
    const other = vi.fn().mockRejectedValue(new Error("syntax"));
    await expect(retryOnLockConflict("test", other, { waitMs: 1 })).rejects.toThrow("syntax");
    expect(other).toHaveBeenCalledTimes(1);
  });
});
