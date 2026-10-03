// The Drizzle handle, backed by a mysql2 connection pool.
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../db/schema.ts";
import { connConfig } from "./db-config.ts";

export const pool = mysql.createPool({
  ...connConfig(),
  connectionLimit: Number(process.env.DB_POOL ?? 5),
  waitForConnections: true,
});

export const db = drizzle(pool, { schema, mode: "default" });

// MariaDB's deadlock and lock-wait-timeout errors. Either rolls back the
// transaction that gets it; running it again is safe and usually succeeds.
const LOCK_CONFLICT_ERRNOS = new Set([1213, 1205]);

/** Whether `err`, or the driver error Drizzle wraps in it, is a lock conflict. */
export function isLockConflict(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++)
    if (LOCK_CONFLICT_ERRNOS.has((e as { errno?: unknown }).errno as number)) return true;
  return false;
}

/**
 * Run a transaction, running it again after a short wait (0.25 s, 1 s, 4 s)
 * if it's rolled back by a deadlock or lock wait timeout. Used by the mirror
 * writes, which the dump import and the app's runs can make at the same time.
 */
export async function retryOnLockConflict<T>(
  label: string,
  fn: () => Promise<T>,
  { retries = 3, waitMs = 250 }: { retries?: number; waitMs?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isLockConflict(err) || attempt >= retries) throw err;
      const wait = waitMs * 4 ** attempt;
      console.warn(`${label}: lock conflict, retrying in ${wait} ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
