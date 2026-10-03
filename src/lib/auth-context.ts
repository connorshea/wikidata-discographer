// Who is logged in (from /api/auth/me), whether login is configured, and which
// wiki the app edits. Tokens never reach the client.
import { createContext, useContext } from "react";
import type { AuthUserInfo } from "./api-types.ts";

export interface AuthState {
  user: AuthUserInfo | null;
  /** False when the server has no OAuth consumer configured. */
  configured: boolean;
  /** True until the first /api/auth/me response lands. */
  loading: boolean;
  /** Origin of the wiki edits go to, e.g. https://www.wikidata.org. */
  wikiBaseUrl: string;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  configured: false,
  loading: true,
  wikiBaseUrl: "https://www.wikidata.org",
  logout: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
