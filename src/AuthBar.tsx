// The login control: a plain link to the server's OAuth start route (a
// full-page navigation, so the redirect to Wikidata and back needs no client
// state), or once logged in, the username and a log out button.
import { useEffect, useState } from "react";
import { loginHref, useAuth } from "./lib/auth-context.ts";

/**
 * Whether the OAuth callback turned the login away because the account is
 * blocked on Wikidata (`?auth=blocked`). Read once and then stripped from the
 * URL, so a reload or a retried login doesn't show it again.
 */
function useBlockedLogin(): boolean {
  const [blocked] = useState(
    () => new URLSearchParams(window.location.search).get("auth") === "blocked",
  );
  useEffect(() => {
    if (!blocked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    window.history.replaceState(window.history.state, "", url);
  }, [blocked]);
  return blocked;
}

export default function AuthBar() {
  const { user, configured, loading, logout, wikiBaseUrl } = useAuth();
  const [busy, setBusy] = useState(false);
  const blockedLogin = useBlockedLogin();
  if (loading) return null;
  if (user)
    return (
      <div className="auth-bar">
        <a
          className="user"
          href={`${wikiBaseUrl}/wiki/User:${encodeURIComponent(user.username)}`}
          target="_blank"
          rel="noreferrer"
        >
          {user.username}
        </a>
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
  return (
    <div className="auth-bar">
      {blockedLogin && (
        <span className="msg err" role="alert">
          Your Wikidata account is blocked, so it can't use this tool. Once the block is lifted, log
          in again.
        </span>
      )}
      <a className="btn" href={loginHref()}>
        Log in with Wikimedia
      </a>
    </div>
  );
}
