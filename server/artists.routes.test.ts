// The artist routes' guards, with the DB, the label search and Wikidata
// mocked: every query reads no rows, and the tests check which ran.
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { artistRoutes } from "./artists.ts";
import type { AuthEnv } from "./auth/session.ts";
import type { ArtistSearchResponse, RecentArtistsResponse } from "../src/lib/api-types.ts";

const mocks = vi.hoisted(() => {
  // A query builder whose every step returns itself, and that reads as no rows.
  const query: Record<string, unknown> = {};
  for (const step of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"])
    query[step] = () => query;
  query.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return {
    select: vi.fn(() => query),
    searchLabels: vi.fn(),
    describeItems: vi.fn(),
  };
});

vi.mock("./db.ts", () => ({ db: { select: mocks.select } }));
vi.mock("./items.ts", () => ({ searchLabels: mocks.searchLabels }));
vi.mock("./wikidata-client.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  describeItems: mocks.describeItems,
}));

const app = new Hono().route("/api/artists", artistRoutes);

const VARIOUS = 3108914;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchLabels.mockResolvedValue([]);
  mocks.describeItems.mockResolvedValue(new Map());
});

async function search(q: string): Promise<ArtistSearchResponse> {
  const res = await app.request(`/api/artists/search?${new URLSearchParams({ q })}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ArtistSearchResponse;
}

describe("Various artists (Q3108914)", () => {
  it("is left out of the search by label", async () => {
    mocks.searchLabels.mockResolvedValue([
      { qid: VARIOUS, kind: "artist", label: "Various artists", description: null },
      { qid: 1, kind: "artist", label: "Various Artists Band", description: null },
    ]);
    const res = await search("Various artists");
    expect(res.artists.map((a) => a.qid)).toEqual(["Q1"]);
  });

  it("isn't found by its QID or Wikidata URL", async () => {
    expect((await search("Q3108914")).artists).toEqual([]);
    expect((await search("https://www.wikidata.org/wiki/Q3108914")).artists).toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.describeItems).not.toHaveBeenCalled();
  });

  it("can't be opened, and its albums aren't queried", async () => {
    const res = await app.request("/api/artists/Q3108914");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Various artists can't be opened on the artist page",
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.describeItems).not.toHaveBeenCalled();
  });

  it("leaves other artists alone", async () => {
    const res = await app.request("/api/artists/Q52583");
    // Not in the (empty) mirror, so it isn't an artist, but it was looked up.
    expect(res.status).toBe(404);
    expect(mocks.select).toHaveBeenCalled();
  });
});

describe("GET /api/artists/recent", () => {
  it("isn't taken for an artist's QID", async () => {
    const loggedIn = new Hono<AuthEnv>()
      .use((c, next) => {
        c.set("user", { id: 1 } as AuthEnv["Variables"]["user"]);
        return next();
      })
      .route("/api/artists", artistRoutes);
    const res = await loggedIn.request("/api/artists/recent");
    expect(res.status).toBe(200);
    expect((await res.json()) as RecentArtistsResponse).toEqual({ artists: [] });
  });
});
