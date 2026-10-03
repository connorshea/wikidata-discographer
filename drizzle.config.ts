import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// MariaDB uses Drizzle's MySQL dialect (there is no `mariadb` dialect). Only
// `generate` runs offline; `migrate`/`push`/`studio` need a reachable DB.
export default defineConfig({
  dialect: "mysql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  migrations: { prefix: "timestamp" },
  dbCredentials: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "discographer",
    password: process.env.DB_PASSWORD ?? "discographer",
    database: process.env.DB_NAME ?? "discographer",
  },
});
