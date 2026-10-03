// The web server entrypoint: checks the DB schema is current, then binds the
// Hono app to $PORT. Runs as the Toolforge webservice (buildservice image).
import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { pool } from "./db.ts";
import { preflight } from "./preflight.ts";
import { markInterrupted } from "./submissions.ts";

await preflight();
// Runs execute in this process, so any still marked running died with the last one.
await markInterrupted();

const port = Number(process.env.PORT ?? 8000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});

// Toolforge (Kubernetes) sends SIGTERM on every restart: stop accepting
// connections, let requests finish, close the pool. Runs in progress are cut
// off and marked interrupted on the next boot.
function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down…`);
  setTimeout(() => process.exit(1), 25_000).unref();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  if ("closeIdleConnections" in server) server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
