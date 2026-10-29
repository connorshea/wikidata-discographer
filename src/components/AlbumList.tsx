// Every album the tool has created or added a tracklist to, newest run first,
// a page at a time (GET /api/albums).
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { AlbumListEntry, AlbumListResponse, AlbumRun, RunArtist } from "../lib/api-types.ts";
import { useAuth } from "../lib/auth-context.ts";
import { api } from "../lib/client.ts";
import { BLOCKED_ARTISTS } from "../lib/music.ts";

const STATUS: Record<AlbumRun["status"], { label: string; tone: string }> = {
  running: { label: "Running", tone: "" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  interrupted: { label: "Interrupted", tone: "warn" },
  unknown: { label: "Outcome unknown", tone: "warn" },
};

/** A page of albums, after the run `before` if given. */
function fetchAlbums(before: number | null, mine: boolean, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (before) q.set("before", String(before));
  if (mine) q.set("mine", "1");
  return api<AlbumListResponse>(`/api/albums?${q}`, { signal });
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Couldn't load the albums.");

export default function AlbumList() {
  const { user, loading } = useAuth();
  const [mine, setMine] = useState(false);
  // The filter needs a login. One whose session ends goes back to every album.
  const onlyMine = mine && !!user;
  const [albums, setAlbums] = useState<AlbumListEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The next page being loaded, if any, which a change of filter makes stale.
  const more = useRef<AbortController | null>(null);

  // The first page, again whenever the filter changes.
  useEffect(() => {
    if (loading) return;
    const ctl = new AbortController();
    // A Show more clicked while this loads used the last filter's cursor.
    const settle = () => more.current?.abort();
    fetchAlbums(null, onlyMine, ctl.signal)
      .then((r) => {
        settle();
        setAlbums(r.albums);
        setNext(r.next);
        setError(null);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        settle();
        // The last filter's albums and cursor would let Show more mix the two.
        setAlbums([]);
        setNext(null);
        setError(errorText(e));
        setBusy(false);
      });
    return () => {
      ctl.abort();
      more.current?.abort();
    };
  }, [onlyMine, loading]);

  const showMore = () => {
    more.current?.abort();
    const ctl = new AbortController();
    more.current = ctl;
    setBusy(true);
    setError(null);
    fetchAlbums(next, onlyMine, ctl.signal)
      .then((r) => {
        if (ctl.signal.aborted) return;
        setAlbums((prev) => [...prev, ...r.albums]);
        setNext(r.next);
        setBusy(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(errorText(e));
        setBusy(false);
      });
  };

  return (
    <section className="block">
      <h2>Albums</h2>
      <p className="hint">All recent albums created with Discographer.</p>
      {user && (
        <label className="row">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setBusy(true);
              setError(null);
            }}
          />
          Only albums I've worked on
        </label>
      )}
      {error && <p className="msg err">{error}</p>}
      {!busy && !error && !albums.length && (
        <p className="hint">{onlyMine ? "You haven't run any albums yet." : "No albums yet."}</p>
      )}
      {albums.length > 0 && (
        <div className="tablewrap">
          <table className="album-list">
            <thead>
              <tr>
                <th>Release</th>
                <th>Type</th>
                <th>Change</th>
                <th>Latest run</th>
                <th>Items created</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {albums.map((a) => (
                <AlbumRow key={a.qid} album={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next !== null && (
        <div className="row">
          <button type="button" className="ghost" disabled={busy} onClick={showMore}>
            {busy ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </section>
  );
}

function AlbumRow({ album }: { album: AlbumListEntry }) {
  const { wikiBaseUrl } = useAuth();
  const [latest, ...earlier] = album.runs;
  return (
    <tr>
      <td>
        <a href={`${wikiBaseUrl}/wiki/${album.qid}`} target="_blank" rel="noreferrer">
          {album.label}
        </a>{" "}
        {album.artists.length > 0 && (
          <>
            by <ArtistLinks artists={album.artists} />{" "}
          </>
        )}
        <span className="muted">{album.qid}</span>
      </td>
      <td>{album.type}</td>
      <td>
        <span className="pill">{album.created ? "Created" : "Added to"}</span>
      </td>
      <td>
        <RunSummary run={latest} />
        {earlier.length > 0 && (
          <details className="earlier-runs">
            <summary>
              {earlier.length === 1 ? "1 earlier run" : `${earlier.length} earlier runs`}
            </summary>
            <ul>
              {earlier.map((r) => (
                <li key={r.id}>
                  <RunSummary run={r} />
                  <span className="muted">
                    {" "}
                    · {r.created} created · <RunLinks run={r} />
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td className="count">{album.runs.reduce((n, r) => n + r.created, 0)}</td>
      <td>
        <RunLinks run={latest} />
      </td>
    </tr>
  );
}

/** Each artist linked to its page, joined like joinNames: "a, b and c". */
function ArtistLinks({ artists }: { artists: RunArtist[] }) {
  return artists.map((a, i) => (
    <Fragment key={a.qid}>
      {i > 0 && (i === artists.length - 1 ? " and " : ", ")}
      {/* Various artists' page doesn't open. */}
      {BLOCKED_ARTISTS.has(a.qid) ? a.label : <Link href={`/artists/${a.qid}`}>{a.label}</Link>}
    </Fragment>
  ));
}

function RunSummary({ run }: { run: AlbumRun }) {
  const status = STATUS[run.status] ?? { label: run.status, tone: "" };
  return (
    <span className="run-summary">
      <span className={`pill ${status.tone}`}>{status.label}</span>{" "}
      <span title={`${run.createdAt} UTC`}>{run.createdAt.slice(0, 10)}</span>{" "}
      <span className="muted">by {run.username}</span>
    </span>
  );
}

function RunLinks({ run }: { run: AlbumRun }) {
  return (
    <>
      <a href={run.editGroupUrl} target="_blank" rel="noreferrer">
        EditGroups
      </a>
      {run.mine && (
        <>
          {" · "}
          <Link href={`/?run=${run.id}`}>Open run</Link>
        </>
      )}
    </>
  );
}
