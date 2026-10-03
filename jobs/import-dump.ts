// Weekly job: rebuild the music mirror from the Wikidata entity JSON dump on
// Toolforge's NFS mount (see server/dump-import.ts). Needs `mount: all`.
//
//   node jobs/import-dump.ts                     # full pass + prune
//   DUMP_LIMIT=2000 node jobs/import-dump.ts     # stop after 2000 items (timing check, no prune)
//   WIKIDATA_JSON_DUMP=/path/to/dump.json.gz …   # another dump (plain .json works too)
//   DUMP_PRUNE=0 …                               # keep items missing from the dump
//   DUMP_PRUNE_FORCE=1 …                         # prune past the 20% safety cap
import { realpathSync } from "node:fs";
import { pool } from "../server/db.ts";
import { DEFAULT_DUMP_PATH, runDumpImport } from "../server/dump-import.ts";

const configured = process.env.WIKIDATA_JSON_DUMP ?? DEFAULT_DUMP_PATH;
// `latest-all.json.gz` is a symlink to a dated file; read the dated file so the
// stamp names the dump and a pointer swap mid-run can't change what's read.
let path = configured;
try {
  path = realpathSync(configured);
} catch {
  // a missing file is reported by the import
}
const limit = process.env.DUMP_LIMIT ? Number(process.env.DUMP_LIMIT) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
  console.error(
    `import-dump: DUMP_LIMIT must be a positive integer, got "${process.env.DUMP_LIMIT}"`,
  );
  process.exit(2);
}

console.log(`import-dump: reading ${path}${limit ? ` (limit ${limit})` : ""}`);
runDumpImport({
  path,
  limit,
  prune: process.env.DUMP_PRUNE !== "0",
  forcePrune: process.env.DUMP_PRUNE_FORCE === "1",
})
  .then(async (s) => {
    console.log(
      `import-dump: dump ${s.stamp} done in ${(s.seconds / 60).toFixed(1)} min — ` +
        `${(s.bytes / 1e9).toFixed(1)} GB, ${s.lines} lines, ${s.parsed} parsed, ${s.matched} items, ` +
        `${s.skipped} bad lines, ${s.pruned} pruned${s.stopped ? " (stopped at limit)" : ""}`,
    );
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("import-dump: failed", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
