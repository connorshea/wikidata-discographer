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
