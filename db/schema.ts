// MariaDB schema (Drizzle's MySQL dialect). The database is created with
// `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`, so string comparisons are exact
// — right for external identifiers; label search lowercases explicitly.
import {
  bigint,
  boolean,
  customType,
  datetime,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// MariaDB's JSON is LONGTEXT underneath and mysql2 returns it as a string, so
// (de)serialize in the ORM layer.
const json = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType() {
      return "json";
    },
    toDriver(value: T): string {
      return JSON.stringify(value);
    },
    fromDriver(value: unknown): T {
      return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
    },
  })(name);

// ---------------------------------------------------------------------------
// The music mirror: artists, albums, EPs, singles, compositions and tracks
// from Wikidata, refreshed weekly from the entity dump (server/dump-import.ts)
// and added to as the app creates items or a user adds a new one.
// ---------------------------------------------------------------------------

export const musicItems = mysqlTable(
  "music_items",
  {
    qid: varchar("qid", { length: 32 }).primaryKey(),
    kind: varchar("kind", { length: 16 }).notNull(), // MusicKind (src/lib/music.ts)
    label: varchar("label", { length: 400 }), // en, else mul, else any
    // Lowercased label, truncated to fit the index, for case-insensitive search.
    labelSearch: varchar("label_search", { length: 191 }),
    description: varchar("description", { length: 400 }),
    instanceOf: json<string[]>("instance_of").notNull(),
    // The revision the row was built from: the dump import skips an item whose
    // dump revision is no newer. Null if unknown (always re-read).
    revid: bigint("revid", { mode: "number" }),
    // MIRROR_VERSION (server/mirror.ts) when the row was written; rows from an
    // older version are re-read from the next dump.
    rowVersion: int("row_version").notNull().default(0),
    // "dump", or "app" for items created or added through the app.
    source: varchar("source", { length: 8 }).notNull().default("dump"),
    updatedAt: datetime("updated_at", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_music_items_label_search").on(t.labelSearch, t.kind)],
);

export const musicExternalIds = mysqlTable(
  "music_external_ids",
  {
    id: int("id").autoincrement().primaryKey(),
    qid: varchar("qid", { length: 32 }).notNull(),
    property: varchar("property", { length: 16 }).notNull(), // e.g. "P2205"
    value: varchar("value", { length: 400 }).notNull(),
  },
  (t) => [
    uniqueIndex("idx_music_external_ids_unique").on(t.qid, t.property, t.value),
    index("idx_music_external_ids_lookup").on(t.property, t.value),
  ],
);

// ---------------------------------------------------------------------------
// Users and sessions — Wikimedia OAuth 2.0 (server/auth/).
// ---------------------------------------------------------------------------

export const users = mysqlTable("users", {
  id: int("id").primaryKey(), // Wikimedia central user id (OAuth profile `sub`)
  username: varchar("username", { length: 255 }).notNull(),
  blocked: boolean("blocked").notNull().default(false),
  createdAt: datetime("created_at", { mode: "string" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: datetime("last_login_at", { mode: "string" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// The cookie holds a random token; only its SHA-256 is stored here.
export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: datetime("last_seen_at", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
  },
  (t) => [
    index("idx_sessions_user_id").on(t.userId),
    index("idx_sessions_expires_at").on(t.expiresAt),
  ],
);

// OAuth tokens, encrypted at rest (server/auth/crypto.ts).
export const oauthTokens = mysqlTable("oauth_tokens", {
  userId: int("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  accessExpiresAt: datetime("access_expires_at", { mode: "string" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "string" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Runs and the edits they made.
// ---------------------------------------------------------------------------

// One row per "Create on Wikidata" click. Every edit in a run shares its
// EditGroups batch, so the whole run can be reviewed or undone together.
export const submissions = mysqlTable(
  "submissions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    editGroup: varchar("edit_group", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(), // running | done | failed | interrupted
    title: varchar("title", { length: 400 }).notNull(), // the album's title or QID, for listings
    albumQid: varchar("album_qid", { length: 32 }),
    input: json<unknown>("input").notNull(), // the submitted form state
    error: text("error"),
    createdAt: datetime("created_at", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    finishedAt: datetime("finished_at", { mode: "string" }),
  },
  (t) => [index("idx_submissions_user_id").on(t.userId, t.id)],
);

// One row per edit attempt, success or failure: the audit trail of what the
// app did under whose account, and the list of items it created.
export const wikidataEdits = mysqlTable(
  "wikidata_edits",
  {
    id: int("id").autoincrement().primaryKey(),
    submissionId: int("submission_id")
      .notNull()
      .references(() => submissions.id),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    op: varchar("op", { length: 16 }).notNull(), // create | addClaims
    key: varchar("key", { length: 64 }), // the plan key of a created item, e.g. "track:0:3"
    kind: varchar("kind", { length: 16 }), // what was created (MusicKind)
    what: varchar("what", { length: 400 }).notNull(), // human-readable target
    qid: varchar("qid", { length: 32 }),
    revid: bigint("revid", { mode: "number" }),
    ok: boolean("ok").notNull(),
    // Statements that were already on the item and so not added again.
    skipped: int("skipped").notNull().default(0),
    errorCode: varchar("error_code", { length: 64 }),
    errorText: text("error_text"),
    createdAt: datetime("created_at", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_wikidata_edits_submission").on(t.submissionId, t.id),
    index("idx_wikidata_edits_user").on(t.userId),
    index("idx_wikidata_edits_qid").on(t.qid),
  ],
);
