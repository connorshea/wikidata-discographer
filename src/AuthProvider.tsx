import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "./lib/client.ts";
import { AuthContext, type AuthState } from "./lib/auth-context.ts";
import type { AuthMeResponse } from "./lib/api-types.ts";

/** The longest delay setTimeout takes; a later retry time just waits again. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** The longest wait between retries of a re-check that failed. */
const MAX_RETRY_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "logout">>({
    user: null,
    configured: false,
    loading: true,
    wikiBaseUrl: "https://www.wikidata.org",
  });
  const [refreshes, setRefreshes] = useState(0);
  /** Re-checks in a row that failed, to back off the next one. */
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<AuthMeResponse>("/api/auth/me")
      .then((me) => {
        if (cancelled) return;
        setFailures(0);
        setState({
          user: me.user,
          configured: me.configured,
          loading: false,
          wikiBaseUrl: me.wikiBaseUrl,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false }));
        if (refreshes > 0) setFailures((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshes]);

  // An account turned away for its age may run once it's old enough. Ask
  // again then, so a page left open doesn't keep the run button disabled.
  // Each answer is a new user object, so a server clock that's a little
  // behind just means another try a second later. A re-check that fails
  // keeps the same user, so it's retried here too, backing off to a minute.
  const { user } = state;
  useEffect(() => {
    const retryAt = user && !user.eligibility.ok ? user.eligibility.retryAt : undefined;
    if (!retryAt) return;
    const backoff = Math.min(1000 * 2 ** failures, MAX_RETRY_MS);
    const wait = Math.min(Math.max(Date.parse(retryAt) - Date.now(), 0) + backoff, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setRefreshes((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [user, failures]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setState((s) => ({ ...s, user: null }));
  }, []);

  return <AuthContext value={{ ...state, logout }}>{children}</AuthContext>;
}
