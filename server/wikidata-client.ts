// The Wikidata Action API client. Edits are made as the logged-in user through
// their OAuth grant (never `bot=1`): `editRequest` loads their access token,
// fetches a CSRF token with `assert=user&assertuser=<name>`, sends `maxlag=5`
// (a run is a batch of edits, not one interactive click), and retries on
// `badtoken`, `maxlag` and `ratelimited`. Anything else becomes a
// `WikidataEditError` carrying Wikidata's own message.
import { wikidataApiUrl } from "./auth/config.ts";
import { deleteTokens, getAccessToken, TokenError } from "./auth/tokens.ts";
import { userAgent } from "./auth/user-agent.ts";
import type { Claim, Snak, Value } from "../src/lib/plan.ts";

const TIMEOUT_MS = 30_000;
const MAXLAG = "5";
const MAX_LAG_RETRIES = 5;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 60_000;

export interface EditUser {
  id: number;
  username: string;
}

export class WikidataEditError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WikidataEditError";
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ApiResponse {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

async function call(
  method: "GET" | "POST",
  params: Record<string, string>,
  accessToken?: string,
): Promise<ApiResponse> {
  const query = new URLSearchParams({
    format: "json",
    formatversion: "2",
    errorformat: "plaintext",
    ...params,
  });
  let res: Response;
  try {
    res = await fetch(method === "GET" ? `${wikidataApiUrl()}?${query}` : wikidataApiUrl(), {
      method,
      headers: {
        "User-Agent": userAgent(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? query : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new WikidataEditError(
      "network",
      `Could not reach Wikidata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, body };
}

interface PlaintextError {
  code?: string;
  text?: string;
  data?: { messages?: { text?: string; name?: string }[] };
}

/** The API's error, if the response is one: code and every message it gave. */
function apiError(res: ApiResponse): { code: string; text: string } | null {
  const errors = res.body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const all = errors as PlaintextError[];
    // Wikibase answers a refused save with a generic `failed-save` and puts the
    // reason in later entries or their `data.messages`.
    const texts = [
      ...all.map((e) => e.text ?? e.code ?? ""),
      ...all.flatMap((e) => (e.data?.messages ?? []).map((m) => m.text ?? m.name ?? "")),
    ].filter((t, i, ts) => t !== "" && ts.indexOf(t) === i);
    return { code: all[0].code ?? "unknown", text: texts.join(" — ") };
  }
  if (res.status >= 400) return { code: `http-${res.status}`, text: `HTTP ${res.status}` };
  return null;
}

const AUTH_FAILURE_CODES = new Set([
  "mwoauth-invalid-authorization",
  "mwoauth-invalid-authorization-invalid-user",
  "assertuserfailed",
  "assertnameduserfailed",
]);

async function fail(user: EditUser, err: { code: string; text: string }): Promise<never> {
  if (AUTH_FAILURE_CODES.has(err.code)) {
    await deleteTokens(user.id);
    throw new WikidataEditError(
      err.code,
      "Wikidata no longer accepts this app's authorization for your account; log in again.",
    );
  }
  throw new WikidataEditError(err.code, err.text || err.code);
}

async function csrfToken(user: EditUser, accessToken: string): Promise<string> {
  const res = await call(
    "GET",
    { action: "query", meta: "tokens", type: "csrf", assert: "user", assertuser: user.username },
    accessToken,
  );
  const err = apiError(res);
  if (err) await fail(user, err);
  const token = (res.body.query as { tokens?: { csrftoken?: string } } | undefined)?.tokens
    ?.csrftoken;
  if (!token || token === "+\\")
    throw new WikidataEditError("notoken", "Wikidata returned no CSRF token");
  return token;
}

function retryAfterMs(headers: Headers, fallback: number): number {
  const seconds = Number(headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : fallback;
}

/** Perform one write action as `user`; resolves to the API's JSON body. */
export async function editRequest(
  user: EditUser,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(user.id);
  } catch (err) {
    if (err instanceof TokenError)
      throw new WikidataEditError(
        "login-required",
        "Your Wikimedia login has expired or was revoked; log in again to edit.",
      );
    throw err;
  }
  let csrf = await csrfToken(user, accessToken);
  let tokenRetries = 0;
  let lagRetries = 0;
  let rateRetries = 0;
  for (;;) {
    const res = await call(
      "POST",
      { ...params, token: csrf, assert: "user", assertuser: user.username, maxlag: MAXLAG },
      accessToken,
    );
    const err = apiError(res);
    if (!err) return res.body;
    if (err.code === "badtoken" && tokenRetries++ < 1) {
      csrf = await csrfToken(user, accessToken);
      continue;
    }
    if (err.code === "maxlag" && lagRetries++ < MAX_LAG_RETRIES) {
      await sleep(retryAfterMs(res.headers, 5_000));
      continue;
    }
    if (
      (err.code === "ratelimited" || err.code === "http-429") &&
      rateRetries++ < MAX_RATE_LIMIT_RETRIES
    ) {
      await sleep(retryAfterMs(res.headers, RATE_LIMIT_WAIT_MS));
      continue;
    }
    await fail(user, err);
  }
}

// ---------------------------------------------------------------------------
// Reads (public, no login needed)
// ---------------------------------------------------------------------------

export interface WikibaseSnak {
  snaktype: string;
  property: string;
  datavalue?: { type: string; value: unknown };
}

export interface WikibaseStatement {
  mainsnak: WikibaseSnak;
  rank?: string;
  qualifiers?: Record<string, WikibaseSnak[]>;
}

export interface Entity {
  id: string;
  type?: string;
  missing?: boolean;
  lastrevid?: number;
  labels?: Record<string, { language: string; value: string }>;
  descriptions?: Record<string, { language: string; value: string }>;
  claims?: Record<string, WikibaseStatement[]>;
}

/** Fetch up to 50 entities' labels, descriptions and claims. Missing ones are left out. */
export async function getEntities(qids: readonly string[]): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  if (qids.length === 0) return out;
  const res = await call("GET", {
    action: "wbgetentities",
    ids: qids.join("|"),
    props: "labels|descriptions|claims",
  });
  const err = apiError(res);
  if (err) throw new WikidataEditError(err.code, err.text);
  const entities = (res.body.entities as Record<string, Entity> | undefined) ?? {};
  for (const [id, entity] of Object.entries(entities)) {
    // A redirected id comes back under the target's id; key by what was asked.
    if (!entity.missing && entity.claims) out.set(id, entity);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan claims → Wikibase JSON
// ---------------------------------------------------------------------------

/** The wiki's concept base (`http://www.wikidata.org/entity/`), for units and calendars. */
function conceptBase(): string {
  return `http://${new URL(wikidataApiUrl()).host}/entity/`;
}

export type Resolve = (ref: string) => string;

function datavalue(v: Value, resolve: Resolve): { type: string; value: unknown } {
  switch (v.type) {
    case "item":
      return {
        type: "wikibase-entityid",
        value: { "entity-type": "item", id: "id" in v ? v.id : resolve(v.ref) },
      };
    case "string":
      return { type: "string", value: v.value };
    case "monolingual":
      return { type: "monolingualtext", value: { text: v.text, language: v.language } };
    case "time":
      return {
        type: "time",
        value: {
          time: v.time,
          timezone: 0,
          before: 0,
          after: 0,
          precision: v.precision,
          calendarmodel: `${conceptBase()}Q1985727`,
        },
      };
    case "quantity":
      return {
        type: "quantity",
        value: { amount: `+${v.amount}`, unit: v.unit ? `${conceptBase()}${v.unit}` : "1" },
      };
  }
}

const snak = (s: Snak, resolve: Resolve): WikibaseSnak => ({
  snaktype: "value",
  property: s.property,
  datavalue: datavalue(s.value, resolve),
});

export function toStatement(c: Claim, resolve: Resolve) {
  const qualifiers: Record<string, WikibaseSnak[]> = {};
  for (const q of c.qualifiers ?? []) (qualifiers[q.property] ??= []).push(snak(q, resolve));
  return {
    type: "statement",
    rank: "normal",
    mainsnak: snak(c, resolve),
    ...(c.qualifiers?.length ? { qualifiers, "qualifiers-order": Object.keys(qualifiers) } : {}),
  };
}

/** A comparable key for a snak's value, to spot statements an item already has. */
export function valueKey(dv: { type: string; value: unknown } | undefined): string {
  if (!dv) return "";
  const v = dv.value as Record<string, unknown> | string;
  switch (dv.type) {
    case "wikibase-entityid":
      return `item:${(v as Record<string, unknown>).id as string}`;
    case "string":
      return `string:${v as string}`;
    case "monolingualtext":
      return `mono:${(v as Record<string, string>).language}:${(v as Record<string, string>).text}`;
    case "time":
      return `time:${(v as Record<string, unknown>).time as string}/${(v as Record<string, unknown>).precision as number}`;
    case "quantity":
      return `qty:${Number((v as Record<string, string>).amount)}:${(v as Record<string, string>).unit}`;
    default:
      return JSON.stringify(v);
  }
}
