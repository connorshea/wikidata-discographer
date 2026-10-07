import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { editEligibility, eligibilityLimits } from "./eligibility.ts";

const now = new Date("2026-10-04T12:00:00Z");
const limits = { minAccountAgeHours: 48, minEditCount: 1 };
const check = (editCount: number | null, registeredAt: string | null) =>
  editEligibility({ editCount, registeredAt }, now, limits);

describe("editEligibility", () => {
  it("lets an established account through", () => {
    expect(check(250, "2020-01-01 00:00:00")).toEqual({ ok: true });
  });

  it("turns away an account with no edits", () => {
    expect(check(0, "2020-01-01 00:00:00")).toEqual({
      ok: false,
      reason:
        "Your account must be at least 48 hours old and have at least 1 edit on Wikidata to create items with this tool. It had 0 edits when you logged in. Once you've made more, log out and back in.",
    });
  });

  it("turns away an account under 48 hours old, saying when to come back", () => {
    expect(check(5, "2026-10-03 09:30:15")).toEqual({
      ok: false,
      reason:
        "Your account must be at least 48 hours old and have at least 1 edit on Wikidata to create items with this tool. You can try again after 2026-10-05 09:31 UTC.",
    });
  });

  it("gives both reasons when both apply", () => {
    const result = check(0, "2026-10-04 11:00:00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("0 edits");
      expect(result.reason).toContain("after 2026-10-06 11:00 UTC");
    }
  });

  it("lets an account through at exactly 48 hours, and not a second before", () => {
    expect(check(1, "2026-10-02 12:00:00")).toEqual({ ok: true });
    expect(check(1, "2026-10-02 12:00:01").ok).toBe(false);
  });

  it("treats an account with no registration date as old enough", () => {
    expect(check(1, null)).toEqual({ ok: true });
    expect(check(0, null).ok).toBe(false);
  });

  it("asks a user who logged in before edit counts were stored to log in again", () => {
    expect(check(null, "2020-01-01 00:00:00")).toEqual({
      ok: false,
      reason: "Log out and back in first, so this tool can check your Wikidata account.",
    });
  });

  it("skips the age check when it's off, even for a registration date in the future", () => {
    const skewed = { editCount: 1, registeredAt: "2026-10-04 12:05:00" };
    expect(editEligibility(skewed, now, { minAccountAgeHours: 0, minEditCount: 1 })).toEqual({
      ok: true,
    });
  });

  it("asks a pre-migration user to log in again while only the age check is on", () => {
    // Their registration date is missing too, which would read as an old account.
    const result = editEligibility({ editCount: null, registeredAt: null }, now, {
      minAccountAgeHours: 48,
      minEditCount: 0,
    });
    expect(result.ok).toBe(false);
  });
  it("follows the configured limits", () => {
    const young = { editCount: 0, registeredAt: "2026-10-04 11:00:00" };
    expect(editEligibility(young, now, { minAccountAgeHours: 0, minEditCount: 0 })).toEqual({
      ok: true,
    });
    expect(editEligibility(young, now, { minAccountAgeHours: 1, minEditCount: 0 })).toEqual({
      ok: true,
    });
    const strict = editEligibility({ editCount: 3, registeredAt: "2020-01-01 00:00:00" }, now, {
      minAccountAgeHours: 0,
      minEditCount: 10,
    });
    expect(strict).toEqual({
      ok: false,
      reason:
        "Your account must have at least 10 edits on Wikidata to create items with this tool. It had 3 edits when you logged in. Once you've made more, log out and back in.",
    });
  });
});

describe("eligibilityLimits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 48 hours and 1 edit", () => {
    vi.stubEnv("EDIT_MIN_ACCOUNT_AGE_HOURS", "");
    vi.stubEnv("EDIT_MIN_EDIT_COUNT", "");
    expect(eligibilityLimits()).toEqual({ minAccountAgeHours: 48, minEditCount: 1 });
  });

  it("reads the environment, ignoring values that aren't whole numbers", () => {
    vi.stubEnv("EDIT_MIN_ACCOUNT_AGE_HOURS", "72");
    vi.stubEnv("EDIT_MIN_EDIT_COUNT", "0");
    expect(eligibilityLimits()).toEqual({ minAccountAgeHours: 72, minEditCount: 0 });
    vi.stubEnv("EDIT_MIN_ACCOUNT_AGE_HOURS", "-1");
    vi.stubEnv("EDIT_MIN_EDIT_COUNT", "1.5");
    expect(eligibilityLimits()).toEqual({ minAccountAgeHours: 48, minEditCount: 1 });
  });
});
