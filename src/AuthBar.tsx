// The login control: a plain link to the server's OAuth start route (a
// full-page navigation, so the redirect to Wikidata and back needs no client
// state), or once logged in, the username and a log out button.
import { useState } from "react";
import { useAuth } from "./lib/auth-context.ts";

export default function AuthBar() {
  const { user, configured, loading, logout, wikiBaseUrl } = useAuth();
  const [busy, setBusy] = useState(false);
  if (loading) return null;
  if (user)
    return (
      <div className="auth-bar">
        <a
          href={`${wikiBaseUrl}/wiki/User:${encodeURIComponent(user.username)}`}
          target="_blank"
          rel="noreferrer"
        >
          {user.username}
        </a>
        {user.blocked && <span className="badge err">blocked</span>}
        <button
          type="button"
          className="ghost small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logout().finally(() => setBusy(false));
          }}
        >
          {busy ? "Logging out…" : "Log out"}
        </button>
      </div>
    );
  if (!configured) return <span className="hint">Login isn't configured on this server.</span>;
  const returnTo = window.location.pathname;
  return (
    <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
      Log in with Wikimedia
    </a>
  );
}
