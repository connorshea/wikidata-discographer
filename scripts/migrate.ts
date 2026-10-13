// Apply pending Drizzle migrations to the configured database, then rebuild
// the mirror's title keys if TITLE_KEY_VERSION (src/lib/titles.ts) moved on.
// Run locally with `pnpm db:migrate`, and on Toolforge as a one-off job
// before/after deploys.
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { connConfig } from "../server/db-config.ts";
import { pool } from "../server/db.ts";
import { rekeyIfBehind } from "../server/mirror.ts";

async function main() {
  const conn = await mysql.createConnection({ ...connConfig(), multipleStatements: true });
  const db = drizzle(conn);
  await migrate(db, { migrationsFolder: "db/migrations" });
  await conn.end();
  console.log("migrations applied");

  let lastLog = Date.now();
  const rekeyed = await rekeyIfBehind({
    onBatch: (read, changed) => {
      if (Date.now() - lastLog < 30_000) return;
      lastLog = Date.now();
      console.log(`re-keying titles: ${read} rows read, ${changed} re-keyed so far`);
    },
  });
  if (rekeyed)
    console.log(`title keys rebuilt: ${rekeyed.read} rows read, ${rekeyed.changed} re-keyed`);
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("migrate failed", err);
    process.exit(1);
  });
