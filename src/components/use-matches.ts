import { useEffect, useState } from "react";
import { api } from "../lib/client.ts";
import { type Answered, stillValid } from "../lib/matches.ts";
import { type Plan, QID, type State } from "../lib/plan.ts";
import type { MatchesRequest, MatchesResponse } from "../lib/api-types.ts";
import { useDebounced } from "./use-debounced.ts";

export type Matches = MatchesResponse["rows"];

/** Where the lookup for existing items stands, for the line above each table. */
export type MatchStatus = "off" | "pending" | "done" | "failed";

/**
 * Existing compositions, tracks and singles in the mirror for the parsed
 * rows: same title and a shared performer, or on the existing album.
 */
export function useMatches(state: State, plan: Plan): { matches: Matches; status: MatchStatus } {
  const albumQid = state.album.qid.trim();
  const request: MatchesRequest = {
    albumQid: state.album.mode === "existing" && QID.test(albumQid) ? albumQid : "",
    rows: plan.parsed.flatMap((rows, di) =>
      rows.flatMap((r) =>
        r.error !== undefined
          ? []
          : [
              {
                key: `${di}:${r.n}`,
                title: r.title,
                performers: r.artists
                  .map((a) => (state.artists[a] ?? "").trim())
                  .filter((q) => QID.test(q)),
              },
            ],
      ),
    ),
  };
  // Debounce the serialized request: a fresh object every render would never settle.
  const current = JSON.stringify(request);
  const key = useDebounced(current, 600);
  const [answered, setAnswered] = useState<Answered | null>(null);
  // The request last answered (or failed), to tell when one is in flight.
  const [settled, setSettled] = useState<{ key: string; failed: boolean } | null>(null);
  useEffect(() => {
    const body = JSON.parse(key) as MatchesRequest;
    // The server only matches by a performer or the album; without either, don't ask.
    if (!body.albumQid && !body.rows.some((r) => r.performers.length)) return;
    const abort = new AbortController();
    api<MatchesResponse>("/api/items/matches", { method: "POST", body, signal: abort.signal })
      .then((r) => {
        setAnswered({ request: body, rows: r.rows });
        setSettled({ key, failed: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setSettled({ key, failed: true });
      });
    return () => abort.abort();
  }, [key]);
  // Rows edited since the last answer drop their matches at once; the rest
  // keep them while the next request is in flight.
  const canAsk = !!request.albumQid || request.rows.some((r) => r.performers.length);
  const status: MatchStatus = !canAsk
    ? "off"
    : key !== current || settled?.key !== key
      ? "pending"
      : settled.failed
        ? "failed"
        : "done";
  return { matches: stillValid(answered, request), status };
}
