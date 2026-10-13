// One-off job: rebuild every mirror row's `label_search` key from its stored
// label, after the way titles are folded (src/lib/titles.ts) changes. Until it
// runs, old keys won't match new ones, so run it right after such a deploy:
//
//   toolforge jobs run rekey-titles --command "node jobs/rekey-titles.ts" \
//     --image tool-wikidata-discographer/tool-wikidata-discographer:latest \
//     --emails onfailure
//
// Safe to run again, and alongside the app: it only rewrites keys that differ.
import { pool } from "../server/db.ts";
import { rekeyLabels } from "../server/mirror.ts";

const started = Date.now();
let lastLog = 0;
rekeyLabels({
  onBatch: (read, changed) => {
    if (Date.now() - lastLog < 30_000) return;
    lastLog = Date.now();
    console.log(`rekey-titles: ${read} rows read, ${changed} re-keyed so far`);
  },
})
  .then(async ({ read, changed }) => {
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    console.log(`rekey-titles: done in ${minutes} min, ${read} rows read, ${changed} re-keyed`);
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("rekey-titles: failed", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
