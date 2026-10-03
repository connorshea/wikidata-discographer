// A small JSON fetch wrapper for the same-origin API. Throws `FetchError`
// (carrying the server's `{ error }` message) on a non-2xx response.
export class FetchError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.name = "FetchError";
    this.status = status;
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
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // not JSON
    }
    throw new FetchError(res.status, message);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
