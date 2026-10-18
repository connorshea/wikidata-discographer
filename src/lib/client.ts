// A small JSON fetch wrapper for the same-origin API. Throws `FetchError`
// (carrying the server's `{ error }` message and the parsed body) on a non-2xx response.
export class FetchError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message?: string, body?: unknown) {
    super(message ?? `Request failed (${status})`);
    this.name = "FetchError";
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized: (() => void) | null = null;

/**
 * Called whenever the API answers 401: the session has ended (expired, or
 * logged out in another tab), so the page goes back to asking for a login.
 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let message: string | undefined;
    let body: unknown;
    try {
      body = JSON.parse(text);
      const error = (body as { error?: unknown } | null)?.error;
      if (typeof error === "string") message = error;
    } catch {
      // not JSON
    }
    if (res.status === 401) onUnauthorized?.();
    throw new FetchError(res.status, message, body);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
