// MariaDB connection settings from the environment, kept apart from db.ts so
// scripts can open their own connection without starting the web pool.
import "dotenv/config";
import type { ConnectionOptions } from "mysql2/promise";

/**
 * Defaults target a local dev DB (`discographer`/`discographer`); on Toolforge
 * these come from the tool's ToolsDB credentials. `dateStrings` returns
 * DATETIME columns as `YYYY-MM-DD HH:MM:SS` strings.
 */
export function connConfig(): ConnectionOptions {
  return {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "discographer",
    password: process.env.DB_PASSWORD ?? "discographer",
    database: process.env.DB_NAME ?? "discographer",
    dateStrings: true,
    charset: "utf8mb4",
    // ToolsDB terminates idle connections; keep the pool honest.
    enableKeepAlive: true,
  };
}
