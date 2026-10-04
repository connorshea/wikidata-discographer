// Loads a MusicBrainz release into the form:
//
//   GET /api/musicbrainz/release/:mbid        the form values for a release
//   GET /api/musicbrainz/release-group/:mbid  its releases, to pick one
//
// The browser can't ask MusicBrainz itself (the CSP and the Toolforge terms
// keep the SPA to same-origin requests), so the server fetches the release,
// finds the items the mirror already has for its MusicBrainz IDs, and returns
// the form values (src/lib/musicbrainz.ts). A release group only lists its
// releases: the tracklist belongs to a release.
//
// MusicBrainz allows one request a second per IP, and Toolforge tools share
// their outgoing IPs, so requests are queued a little over a second apart,
// a 503 (its rate-limit answer) is retried after a wait, and releases are
// answers are cached for a while.
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { propertyNumber, toQid } from "./ids.ts";
import { musicExternalIds, musicItems } from "../db/schema.ts";
import { wikidataApiUrl } from "./auth/config.ts";
import { userAgent } from "./auth/user-agent.ts";
import type { AuthEnv } from "./auth/session.ts";
import {
  type MbLookups,
  type MbRelease,
  type MbReleaseListing,
  parseMbInput,
  releaseChoices,
  releaseIds,
  releaseToForm,
  wikidataLink,
} from "../src/lib/musicbrainz.ts";
import type { MusicKind } from "../src/lib/music.ts";
import type { MusicBrainzReleaseGroupResponse, MusicBrainzResponse } from "../src/lib/api-types.ts";

const API_URL = () =>
  (process.env.MUSICBRAINZ_API_URL ?? "https://musicbrainz.org/ws/2").replace(/\/+$/, "");
const RELEASE_INC =
  "recordings+artist-credits+release-groups+work-rels+recording-level-rels+url-rels+release-group-level-rels";
/** MusicBrainz's largest page, and how many pages of a release group's releases to read. */
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

export class MusicBrainzError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MusicBrainzError";
    this.status = status;
  }
}

export interface ClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** The gap kept between requests. */
  gapMs: number;
  cacheMs: number;
  cacheSize: number;
}

const defaultDeps = (): ClientDeps => ({
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  gapMs: 1100,
  cacheMs: 10 * 60_000,
  cacheSize: 50,
});

export function createMusicBrainzClient(overrides: Partial<ClientDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  // When the next request may start. Each caller takes the next slot in turn.
  let nextSlot = 0;
  const cache = new Map<string, { at: number; body: unknown }>();

  async function waitTurn() {
    const now = deps.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + deps.gapMs;
    if (slot > now) await deps.sleep(slot - now);
  }

  async function get(path: string, notFound: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      await waitTurn();
      let res: Response;
      try {
        res = await deps.fetch(`${API_URL()}${path}`, {
          headers: { "User-Agent": userAgent(), Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new MusicBrainzError(
          502,
          `Could not reach MusicBrainz: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (res.ok) return res.json();
      // MusicBrainz answers 400 for an ID that's well-formed but not a valid UUID.
      if (res.status === 404 || res.status === 400) throw new MusicBrainzError(404, notFound);
      if ((res.status === 503 || res.status === 429) && attempt < MAX_RETRIES) {
        const after = Number(res.headers.get("retry-after"));
        await deps.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 2000);
        continue;
      }
      throw new MusicBrainzError(
        502,
        res.status === 503 || res.status === 429
          ? "MusicBrainz is busy. Try again in a minute."
          : `MusicBrainz answered with an error (${res.status}).`,
      );
    }
  }

  async function cached(path: string, notFound: string): Promise<unknown> {
    const hit = cache.get(path);
    if (hit && deps.now() - hit.at < deps.cacheMs) return hit.body;
    const body = await get(path, notFound);
    cache.delete(path);
    cache.set(path, { at: deps.now(), body });
    while (cache.size > deps.cacheSize) cache.delete(cache.keys().next().value!);
    return body;
  }

  return {
    release: async (mbid: string) =>
      (await cached(
        `/release/${mbid}?inc=${RELEASE_INC}&fmt=json`,
        "MusicBrainz has no release with that ID. If it's a release group's ID, paste the release group's URL instead.",
      )) as MbRelease,
    /**
     * A release group's official releases, or every release when it has no
     * official ones, up to `MAX_PAGES` pages, and how many there are. They
     * don't come in date order, so a partial list may miss the earliest.
     */
    releaseGroup: async (mbid: string) => {
      const list = async (status: string) => {
        const releases: MbReleaseListing[] = [];
        let total = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
          const body = (await cached(
            `/release?release-group=${mbid}${status}&inc=media&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&fmt=json`,
            "MusicBrainz has no release group with that ID.",
          )) as { releases: MbReleaseListing[]; "release-count": number };
          releases.push(...body.releases);
          total = body["release-count"];
          if (releases.length >= total || !body.releases.length) break;
        }
        return { releases, total };
      };
      const official = await list("&status=official");
      return official.total ? official : list("");
    },
  };
}

const client = createMusicBrainzClient();

/**
 * Items in the mirror holding these values of `property`, value → QID, kept
 * only when the value points at exactly one item of the given kinds.
 */
async function lookup(property: string, values: string[], kinds: MusicKind[]) {
  const out: Record<string, string> = {};
  if (!values.length) return out;
  const rows = await db
    .select({ qid: musicExternalIds.qid, value: musicExternalIds.value })
    .from(musicExternalIds)
    .innerJoin(musicItems, eq(musicItems.qid, musicExternalIds.qid))
    .where(
      and(
        eq(musicExternalIds.property, propertyNumber(property)),
        inArray(musicExternalIds.value, values),
        inArray(musicItems.kind, kinds),
      ),
    );
  const seen = new Map<string, Set<number>>();
  for (const r of rows) seen.set(r.value, (seen.get(r.value) ?? new Set()).add(r.qid));
  for (const [value, qids] of seen) if (qids.size === 1) out[value] = toQid([...qids][0]);
  return out;
}

/** The release's MusicBrainz IDs, looked up in the mirror. */
export async function lookupRelease(release: MbRelease): Promise<MbLookups> {
  const ids = releaseIds(release);
  const [albums, artists, recordings, works] = await Promise.all([
    lookup("P436", [ids.releaseGroup], ["album", "ep"]),
    lookup("P434", ids.artists, ["artist"]),
    lookup("P4404", ids.recordings, ["track"]),
    lookup("P435", ids.works, ["work"]),
  ]);
  // MusicBrainz's own Wikidata link names a wikidata.org item, which is
  // only right when that's where the edits go.
  const onWikidata = /^(?:www\.)?wikidata\.org$/.test(new URL(wikidataApiUrl()).host);
  const albumQid =
    albums[ids.releaseGroup] ??
    (onWikidata ? wikidataLink(release["release-group"].relations) : undefined);
  return { albumQid, artists, recordings, works };
}

export const musicbrainzRoutes = new Hono<AuthEnv>();

/** The route's MBID, of the kind it takes, or a 400 answer. */
function mbidParam(raw: string, kind: "release" | "release-group") {
  const parsed = parseMbInput(raw);
  if (!parsed.ok) return parsed;
  // A bare MBID parses as a release, but the route says which it is.
  return parsed.kind === kind || /^[0-9a-f-]{36}$/i.test(raw.trim())
    ? { ok: true as const, id: parsed.id }
    : { ok: false as const, error: `That's not a MusicBrainz ${kind.replace("-", " ")}.` };
}

const mbError = (err: unknown) => {
  if (!(err instanceof MusicBrainzError)) throw err;
  return { error: err.message, status: err.status === 404 ? (404 as const) : (502 as const) };
};

musicbrainzRoutes.get("/release/:mbid", async (c) => {
  const parsed = mbidParam(c.req.param("mbid"), "release");
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  let release: MbRelease;
  try {
    release = await client.release(parsed.id);
  } catch (err) {
    const { error, status } = mbError(err);
    return c.json({ error }, status);
  }
  const form = releaseToForm(release, await lookupRelease(release));
  return c.json({ form } satisfies MusicBrainzResponse);
});

musicbrainzRoutes.get("/release-group/:mbid", async (c) => {
  const parsed = mbidParam(c.req.param("mbid"), "release-group");
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  try {
    const { releases, total } = await client.releaseGroup(parsed.id);
    if (!releases.length)
      return c.json({ error: "That release group has no releases on MusicBrainz." }, 404);
    return c.json({
      releases: releaseChoices(releases),
      total,
    } satisfies MusicBrainzReleaseGroupResponse);
  } catch (err) {
    const { error, status } = mbError(err);
    return c.json({ error }, status);
  }
});
