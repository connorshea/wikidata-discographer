// DATETIME columns are `mode: "string"` and the driver returns them as
// `YYYY-MM-DD HH:MM:SS`. Every auth timestamp that gets *compared* (session
// expiry, token expiry) is written from JS in UTC via these helpers and read
// back the same way, so the DB server's session time zone never matters.

export function toSqlDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function fromSqlDatetime(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

export function addSeconds(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000);
}

/**
 * A registration date from the OAuth profile as a SQL DATETIME, or null when
 * there is none. MediaWiki sends `User::getRegistration()`: a 14-digit UTC
 * timestamp (`YYYYMMDDHHMMSS`), or null/false for accounts too old to have
 * one. An ISO string is accepted too, in case the format changes.
 */
export function registrationToSql(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  const mw = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  const d = mw ? new Date(`${mw[1]}-${mw[2]}-${mw[3]}T${mw[4]}:${mw[5]}:${mw[6]}Z`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : toSqlDatetime(d);
}
