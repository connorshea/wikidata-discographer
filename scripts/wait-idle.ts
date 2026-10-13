// Wait until no run is making edits, so a `toolforge webservice restart` doesn't
// cut one off (server/index.ts). Exits 0 once none is running, or 1 if some
// still are after the wait (default 15 minutes, or the first argument in
// minutes). Run on Toolforge as a one-off job before the restart.
//
// A run's row is "running" only while the web process is working on it: the
// server marks the ones a restart left behind on boot (markInterrupted).
import { desc, eq } from "drizzle-orm";
import { submissions, users } from "../db/schema.ts";
import { db, pool } from "../server/db.ts";

const POLL_MS = 15_000;

async function runningRuns() {
  return db
    .select({
      id: submissions.id,
      title: submissions.title,
      username: users.username,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.userId))
    .where(eq(submissions.status, "running"))
    .orderBy(desc(submissions.id));
}

async function main(): Promise<boolean> {
  const minutes = Number(process.argv[2] ?? 15);
  if (!Number.isFinite(minutes) || minutes < 0)
    throw new Error(`Not a number of minutes: ${process.argv[2]}`);
  const deadline = Date.now() + minutes * 60_000;
  let last = "";
  for (;;) {
    const runs = await runningRuns();
    if (runs.length === 0) {
      console.log("no runs in progress");
      return true;
    }
    const list = runs
      .map((r) => `  #${r.id} ${r.title} by ${r.username}, started ${r.createdAt} UTC`)
      .join("\n");
    if (list !== last) console.log(`${runs.length} run(s) in progress:\n${list}`);
    last = list;
    if (Date.now() + POLL_MS > deadline) {
      console.log(`still running after ${minutes} min, don't restart yet`);
      return false;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main()
  .then(async (idle) => {
    await pool.end();
    process.exit(idle ? 0 : 1);
  })
  .catch((err) => {
    console.error("wait-idle failed", err);
    process.exit(1);
  });
