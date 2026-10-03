// The Hono app: the JSON API under /api plus the built React SPA (dist/client)
// for everything else. Kept apart from the listener (server/index.ts).
//
// In dev the SPA is served by Vite, which proxies /api here (vite.config.ts).
import { existsSync, readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes } from "./auth/oauth.ts";
import { sameOriginOnly } from "./auth/same-origin.ts";
import { type AuthEnv, sessionMiddleware } from "./auth/session.ts";
import { items } from "./items.ts";
import { submissionRoutes } from "./submissions.ts";

const CLIENT_DIR = process.env.CLIENT_DIR ?? "./dist/client";
const INDEX_HTML = `${CLIENT_DIR}/index.html`;

export const app = new Hono<AuthEnv>();

// The built SPA is all same-origin scripts, styles and fonts (no third-party
// requests, per the Toolforge terms of use).
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);

app.use("/api/*", sameOriginOnly);
app.use("/api/*", sessionMiddleware);
app.route("/api/auth", authRoutes); // /api/auth/{login,callback,logout,me}
app.route("/api/items", items);
app.route("/api/submissions", submissionRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.use("/*", serveStatic({ root: CLIENT_DIR }));
const indexHtml = existsSync(INDEX_HTML) ? readFileSync(INDEX_HTML, "utf8") : null;
app.notFound((c) =>
  indexHtml
    ? c.html(indexHtml)
    : c.text("Client build not found. Run `pnpm build` (or set CLIENT_DIR).", 500),
);
