// Whether a user's Wikidata account is established enough to create items
// with this tool, so a throwaway account can't mass-create albums and tracks.
// The edit count and registration date are Wikidata-local values captured at
// login (server/auth/oauth.ts). The age is measured from the stored
// registration date, so it is never stale; the edit count is, until the user
// logs in again.
import type { EditEligibility } from "../../src/lib/api-types.ts";
import type { AuthUser } from "./session.ts";
import { fromSqlDatetime } from "./time.ts";

export interface EligibilityLimits {
  minAccountAgeHours: number;
  minEditCount: number;
}

/** A whole number from the environment, or `fallback` when it's unset or not one. */
function envCount(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function eligibilityLimits(): EligibilityLimits {
  return {
    minAccountAgeHours: envCount("EDIT_MIN_ACCOUNT_AGE_HOURS", 48),
    minEditCount: envCount("EDIT_MIN_EDIT_COUNT", 1),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `2026-10-06 14:05 UTC`, rounded up so "after" it is never too early. */
function formatUtc(d: Date): string {
  const up = new Date(Math.ceil(d.getTime() / 60_000) * 60_000);
  return `${up.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function editEligibility(
  user: Pick<AuthUser, "editCount" | "registeredAt">,
  now = new Date(),
  limits = eligibilityLimits(),
): EditEligibility {
  const { minAccountAgeHours, minEditCount } = limits;
  if (minAccountAgeHours === 0 && minEditCount === 0) return { ok: true };
  // A null edit count means the profile was never captured, so the
  // registration date is missing too and would pass the age check as an old
  // account's. Either check needs the user to log in again.
  if (user.editCount === null)
    return {
      ok: false,
      reason: "Log out and back in first, so this tool can check your Wikidata account.",
    };

  // An account with no registration date on record predates MediaWiki
  // keeping them, so it is old enough.
  const eligibleAt =
    minAccountAgeHours === 0 || user.registeredAt === null
      ? null
      : new Date(fromSqlDatetime(user.registeredAt).getTime() + minAccountAgeHours * 3_600_000);
  const tooNew = eligibleAt !== null && eligibleAt > now;
  const tooFewEdits = user.editCount < minEditCount;
  if (!tooNew && !tooFewEdits) return { ok: true };

  const rule = [
    minAccountAgeHours > 0 && `be at least ${plural(minAccountAgeHours, "hour")} old`,
    minEditCount > 0 && `have at least ${plural(minEditCount, "edit")} on Wikidata`,
  ]
    .filter(Boolean)
    .join(" and ");
  const parts = [`Your account must ${rule} to create items with this tool.`];
  if (tooFewEdits)
    parts.push(
      `It had ${plural(user.editCount, "edit")} when you logged in. Once you've made more, log out and back in.`,
    );
  if (!tooNew) return { ok: false, reason: parts.join(" ") };
  parts.push(`You can try again after ${formatUtc(eligibleAt)}.`);
  return { ok: false, reason: parts.join(" "), retryAt: eligibleAt.toISOString() };
}
