// Boot-time schema check: refuse to serve against a database with pending
// migrations, comparing the rows in Drizzle's `__drizzle_migrations` with the
// entries in db/migrations/meta/_journal.json.
import { readFile } from "node:fs/promises";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "./db.ts";

const JOURNAL_URL = new URL("../db/migrations/meta/_journal.json", import.meta.url);

async function appliedMigrations(): Promise<number> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "select count(*) as n from `__drizzle_migrations`",
    );
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return 0;
    throw err;
  }
}

export async function preflight(): Promise<void> {
  const journal = JSON.parse(await readFile(JOURNAL_URL, "utf8")) as { entries: unknown[] };
  const expected = journal.entries.length;
  let applied: number;
  try {
    applied = await appliedMigrations();
  } catch (err) {
    console.error("preflight: can't reach the database", err);
    process.exit(1);
  }
  if (applied < expected) {
    console.error(
      `DB schema is behind: ${expected} migrations in db/migrations, ${applied} applied. ` +
        "Run `node scripts/migrate.ts` first.",
    );
    process.exit(1);
  }
}
