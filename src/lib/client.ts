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
    throw new FetchError(res.status, message, body);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
