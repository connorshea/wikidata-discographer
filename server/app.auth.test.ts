// Every API endpoint but the login flow answers 401 logged out. Walks the
// routes the app has registered, so a new one can't be left open by mistake.
import { describe, expect, it } from "vite-plus/test";
import { app } from "./app.ts";

/**
 * Each API route the app has, other than the login flow and the 404 catch-all.
 * A route with its own middleware is listed once per handler, so once here.
 */
const routes = [
  ...new Map(
    app.routes
      .filter(
        (r) =>
          r.path.startsWith("/api/") && !r.path.startsWith("/api/auth/") && !r.path.includes("*"),
      )
      .map((r) => [`${r.method} ${r.path}`, r]),
  ).values(),
];

describe("login gate", () => {
  it("finds the routes to check", () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain("GET /api/albums");
    expect(paths).toContain("POST /api/items/:qid");
    expect(paths).toContain("GET /api/musicbrainz/release/:mbid");
  });

  it.each(routes.map((r) => [r.method, r.path]))("%s %s needs a login", async (method, path) => {
    const res = await app.request(path.replaceAll(/:\w+/g, "Q1"), {
      method,
      // Past the same-origin check, so it's the login that turns it away.
      headers: { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Login required" });
  });

  it("leaves the login flow open", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
  });

  it("answers an unknown API path with 401 rather than saying what exists", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(401);
  });
});
