import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api } from "./lib/client.ts";
import { AuthContext, type AuthState } from "./lib/auth-context.ts";
import type { AuthMeResponse } from "./lib/api-types.ts";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "logout">>({
    user: null,
    configured: false,
    loading: true,
    wikiBaseUrl: "https://www.wikidata.org",
  });

  useEffect(() => {
    let cancelled = false;
    api<AuthMeResponse>("/api/auth/me")
      .then((me) => {
        if (!cancelled)
          setState({
            user: me.user,
            configured: me.configured,
            loading: false,
            wikiBaseUrl: me.wikiBaseUrl,
          });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setState((s) => ({ ...s, user: null }));
  }, []);

  return <AuthContext value={{ ...state, logout }}>{children}</AuthContext>;
}
