// The Hono app: the JSON API under /api plus the built React SPA (dist/client)
// for everything else. Kept apart from the listener (server/index.ts).
//
// In dev the SPA is served by Vite, which proxies /api here (vite.config.ts).
import { existsSync, readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { albumRoutes } from "./albums.ts";
import { artistRoutes } from "./artists.ts";
import { authRoutes } from "./auth/oauth.ts";
import { sameOriginOnly } from "./auth/same-origin.ts";
import { type AuthEnv, requireUser, sessionMiddleware } from "./auth/session.ts";
import { baseUrl } from "./auth/config.ts";
import { items } from "./items.ts";
import { musicbrainzRoutes } from "./musicbrainz.ts";
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
// Every endpoint but these needs a login: the rest query the database or call
// Wikidata and MusicBrainz on the server's behalf, which shouldn't be open to
// anyone. The login flow (/api/auth/*) has to work logged out, and the album
// list is public, like the edits themselves.
/** Whether an API path works logged out. */
export const isPublicApi = (path: string) =>
  path.startsWith("/api/auth/") || path === "/api/albums";
app.use("/api/*", (c, next) => (isPublicApi(c.req.path) ? next() : requireUser(c, next)));
app.route("/api/albums", albumRoutes);
app.route("/api/artists", artistRoutes);
app.route("/api/auth", authRoutes); // /api/auth/{login,callback,logout,me}
app.route("/api/items", items);
app.route("/api/musicbrainz", musicbrainzRoutes);
app.route("/api/submissions", submissionRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// serveStatic sets no Cache-Control itself, and browsers then cache off
// Last-Modified heuristically: a returning visitor could keep a stale
// index.html whose hashed chunks no longer exist after a deploy (blank page
// until a hard reload). So the shell always revalidates, the content-hashed
// files under /assets are immutable, and the few unhashed files (the favicon)
// get a short lifetime. Set after the fact on the response, since
// serveStatic's onFound runs once its Response is already built and headers
// set there are lost. The API block above has already answered /api/*
// requests, so this middleware never sees them.
/** The Cache-Control for a 200 at `path` with the given Content-Type. */
export function cacheControlFor(path: string, contentType: string | null): string {
  if (contentType?.startsWith("text/html")) return "no-cache";
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

app.use("/*", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set(
      "Cache-Control",
      cacheControlFor(c.req.path, c.res.headers.get("Content-Type")),
    );
  }
});

// The link preview tags in index.html need absolute URLs, so the shell is
// served from here with BASE_URL filled in, at / and /index.html too (where
// serveStatic would otherwise send the file as it is).
const indexHtml = existsSync(INDEX_HTML)
  ? readFileSync(INDEX_HTML, "utf8").replaceAll("__BASE_URL__", baseUrl())
  : null;
const serveShell = (c: Context) =>
  indexHtml
    ? c.html(indexHtml)
    : c.text("Client build not found. Run `pnpm build` (or set CLIENT_DIR).", 500);
app.get("/", serveShell);
app.get("/index.html", serveShell);
app.use("/*", serveStatic({ root: CLIENT_DIR }));
app.notFound(serveShell);
