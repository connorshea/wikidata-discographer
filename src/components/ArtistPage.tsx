// The artist page: find an artist, then see their albums and EPs on Wikidata
// (as of the mirror), oldest first, with which still need a tracklist. Each
// one that does can start the form (/?album=<qid>, and &rg=<mbid> to load its
// MusicBrainz release group). Their singles follow, in a block of their own.
import { Fragment, useEffect, useId, useState } from "react";
import { Link } from "wouter";
import type {
  ArtistAlbum,
  ArtistResponse,
  ArtistResult,
  ArtistSearchResponse,
  ArtistSingle,
} from "../lib/api-types.ts";
import { useAuth } from "../lib/auth-context.ts";
import { api, FetchError } from "../lib/client.ts";
import { useDebounced } from "./use-debounced.ts";

/** Albums shown at first, and added by each Show more. */
const PAGE = 50;
/** Singles shown until Show all. */
const SINGLES_SHOWN = 10;

/** The artist search, and the artist's albums once one is picked. */
export default function ArtistPage({ qid }: { qid: string | null }) {
  const { user } = useAuth();
  return (
    <>
      {/* Siblings, so the keys must differ, or React keeps the old search
          beside the new one when the artist changes. */}
      <ArtistSearch key={`search:${qid}`} />
      {/* Every artist endpoint needs a login. */}
      {qid && user && <ArtistAlbums key={`albums:${qid}`} qid={qid} />}
    </>
  );
}

/** A search's answer, tagged with the query it answers. `artists` is null if it failed. */
type SearchResult = { q: string; artists: ArtistResult[] | null };

function ArtistSearch() {
  const id = useId();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 400);
  const [result, setResult] = useState<SearchResult | null>(null);
  useEffect(() => {
    if (!q || !user) return;
    let cancelled = false;
    api<ArtistSearchResponse>(`/api/artists/search?${new URLSearchParams({ q })}`)
      .then((r) => !cancelled && setResult({ q, artists: r.artists }))
      .catch(() => !cancelled && setResult({ q, artists: null }));
    return () => {
      cancelled = true;
    };
  }, [q, user]);
  const typed = query.trim();
  // Still settling, or asked and not answered yet: never show a stale answer.
  const searching = !!typed && (q !== typed || result?.q !== typed);
  const artists = !searching && typed ? result?.artists : undefined;
  return (
    <section className="block artist-search">
      <h2>Artists</h2>
      <p className="hint">Find an artist to see their albums and EPs on Wikidata.</p>
      <label htmlFor={id} className="visually-hidden">
        Artist name or QID
      </label>
      <div className="search-field">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5L17 17" />
        </svg>
        <input
          id={id}
          type="search"
          placeholder="Artist name or QID"
          value={query}
          aria-describedby={`${id}-status`}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div id={`${id}-status`} role="status" className="search-status">
        {!typed ? (
          <span className="sub">A QID or Wikidata URL also works.</span>
        ) : searching ? (
          <span className="search-state">
            <span className="spinner" aria-hidden="true" />
            Searching Wikidata…
          </span>
        ) : artists === null ? (
          <span className="search-state">Couldn't search Wikidata. Try again in a moment.</span>
        ) : artists?.length === 0 ? (
          <span className="search-state">
            No artists match "{typed}". Check the spelling, or paste the artist's QID.
          </span>
        ) : (
          <span className="sub">
            {artists?.length === 1 ? "1 artist" : `${artists?.length} artists`} on Wikidata
          </span>
        )}
      </div>
      {!!artists?.length && (
        <ul className="artist-results">
          {artists.map((a) => (
            <li key={a.qid}>
              <Link href={`/artists/${a.qid}`} className="artist-result">
                <span className="artist-result-text">
                  <span>
                    <b>{a.label ?? a.qid}</b> <span className="mono muted">{a.qid}</span>
                  </span>
                  <span className="muted">
                    {[
                      a.description,
                      a.albums === 0
                        ? "no albums or EPs on Wikidata"
                        : a.albums === 1
                          ? "1 album or EP"
                          : `${a.albums} albums and EPs`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="artist-result-go" aria-hidden="true">
                  Show albums →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Filter = "all" | "todo" | "done";

const FILTERS: { id: Filter; label: string; keep: (a: ArtistAlbum) => boolean }[] = [
  { id: "all", label: "All", keep: () => true },
  { id: "todo", label: "Needs a tracklist", keep: (a) => a.tracks === 0 },
  { id: "done", label: "Has a tracklist", keep: (a) => a.tracks > 0 },
];

/** A run's day, e.g. "Oct 17", with the year when it isn't this year's. */
function runDay(createdAt: string): string {
  // Stored in UTC as "YYYY-MM-DD HH:MM:SS".
  const d = new Date(`${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return createdAt.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function ArtistAlbums({ qid }: { qid: string }) {
  const { wikiBaseUrl } = useAuth();
  const [data, setData] = useState<ArtistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  // The album a single's Taken from link last jumped to: a new object each
  // time, so jumping to the same one again scrolls again.
  const [jump, setJump] = useState<{ qid: string } | null>(null);
  useEffect(() => {
    if (jump) document.getElementById(albumRowId(jump.qid))?.scrollIntoView({ block: "center" });
  }, [jump]);
  useEffect(() => {
    const ctl = new AbortController();
    api<ArtistResponse>(`/api/artists/${encodeURIComponent(qid)}`, { signal: ctl.signal })
      .then(setData)
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(
          e instanceof FetchError && e.status < 500
            ? e.message
            : "Couldn't load the artist's albums. Try again in a moment.",
        );
      });
    return () => ctl.abort();
  }, [qid]);

  if (error)
    return (
      <section className="block">
        <p className="msg err">{error}</p>
      </section>
    );
  if (!data)
    return (
      <section className="block">
        <span className="search-state">
          <span className="spinner" aria-hidden="true" />
          Loading the albums…
        </span>
      </section>
    );

  const { artist, albums } = data;
  const name = artist.label ?? artist.qid;
  const listed = albums.filter(FILTERS.find((f) => f.id === filter)!.keep);
  /** Show the album's row, under All so a filter can't hide it, and scroll to it. */
  const jumpTo = (qid: string) => {
    setFilter("all");
    setShown(Math.max(shown, albums.findIndex((a) => a.qid === qid) + 1));
    setJump({ qid });
  };
  return (
    <>
      <section className="block artist">
        <div className="artist-head">
          <div className="artist-name">
            <h2>
              {name}{" "}
              <a
                className="mono artist-qid"
                href={`${wikiBaseUrl}/wiki/${artist.qid}`}
                target="_blank"
                rel="noreferrer"
              >
                {artist.qid}
              </a>
            </h2>
            {artist.description && <span className="muted">{artist.description}</span>}
          </div>
          <a href={`${wikiBaseUrl}/wiki/${artist.qid}`} target="_blank" rel="noreferrer">
            Open on Wikidata ↗
          </a>
        </div>
        {albums.length === 0 ? (
          <p className="search-state">
            <span>
              No albums or EPs on Wikidata list {name} as performer.{" "}
              <Link href="/">Create a new album</Link> to add one.
            </span>
          </p>
        ) : (
          <>
            <div className="artist-tools">
              <div className="filters" role="group" aria-label="Show">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    onClick={() => {
                      setFilter(f.id);
                      setShown(PAGE);
                    }}
                  >
                    {f.label} <span className="filter-count">{albums.filter(f.keep).length}</span>
                  </button>
                ))}
              </div>
              <span className="muted">Albums and EPs with {name} as performer</span>
            </div>
            {listed.length === 0 ? (
              <p className="hint">
                {filter === "todo"
                  ? "Every album and EP here has a tracklist."
                  : "None of these albums or EPs has a tracklist yet."}
              </p>
            ) : (
              <div className="tablewrap">
                <table className="artist-albums">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Tracklist</th>
                      <th>
                        <span className="visually-hidden">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.slice(0, shown).map((a) => (
                      <AlbumRow key={a.qid} album={a} wikiBaseUrl={wikiBaseUrl} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {listed.length > shown && (
              <div className="row">
                <button type="button" className="ghost" onClick={() => setShown(shown + PAGE)}>
                  Show {Math.min(PAGE, listed.length - shown)} more
                </button>
                <span className="muted">
                  Showing {shown} of {listed.length}
                </span>
              </div>
            )}
            <p className="sub artist-note">
              Add tracklist opens the New album form with that album picked. With{" "}
              <span className="mb-badge">MB</span> it loads the album's MusicBrainz release group,
              so the tracks fill in for you. The list is from a copy of Wikidata that's refreshed
              weekly, so the latest changes may not show yet.
              {data.truncated && ` Only the first ${albums.length} are listed.`}
            </p>
          </>
        )}
      </section>
      {data.singles.length > 0 && (
        <ArtistSingles
          name={name}
          singles={data.singles}
          truncated={data.singlesTruncated}
          albums={new Set(albums.map((a) => a.qid))}
          onJump={jumpTo}
        />
      )}
    </>
  );
}

/**
 * The artist's singles: no filters, as those are the albums', and no Add
 * tracklist, as a single can't be picked to add one to yet.
 */
function ArtistSingles({
  name,
  singles,
  truncated,
  albums,
  onJump,
}: {
  name: string;
  singles: ArtistSingle[];
  truncated: boolean;
  /** The artist's listed albums, whose rows a Taken from link goes to. */
  albums: ReadonlySet<string>;
  onJump: (qid: string) => void;
}) {
  const { wikiBaseUrl } = useAuth();
  const [all, setAll] = useState(false);
  const listed = all ? singles : singles.slice(0, SINGLES_SHOWN);
  return (
    <section className="block artist">
      <div className="singles-head">
        <h3>
          <span className="sw" aria-hidden="true" />
          Singles
        </h3>
        <span className="muted">Singles with {name} as performer</span>
      </div>
      <div className="tablewrap">
        <table className="artist-albums">
          <thead>
            <tr>
              <th>Year</th>
              <th>Title</th>
              <th>Taken from</th>
              <th>Tracklist</th>
              <th>
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((s) => (
              <tr key={s.qid}>
                <td className="year" title={s.released ?? "No release date on Wikidata"}>
                  {s.released ? s.released.slice(0, 4) : "—"}
                </td>
                <td>
                  <span className="title">{s.label ?? s.qid}</span>{" "}
                  <a
                    className="mono muted"
                    href={`${wikiBaseUrl}/wiki/${s.qid}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.qid}
                  </a>
                </td>
                <td>
                  {s.takenFrom.length === 0 ? (
                    <span className="muted">Not on an album</span>
                  ) : (
                    s.takenFrom.map((a, i) => (
                      <Fragment key={a.qid}>
                        {i > 0 && " · "}
                        {albums.has(a.qid) ? (
                          <a
                            href={`#${albumRowId(a.qid)}`}
                            onClick={(e) => {
                              e.preventDefault();
                              onJump(a.qid);
                            }}
                          >
                            {a.label ?? a.qid}
                          </a>
                        ) : (
                          <a href={`${wikiBaseUrl}/wiki/${a.qid}`} target="_blank" rel="noreferrer">
                            {a.label ?? a.qid}
                          </a>
                        )}
                      </Fragment>
                    ))
                  )}
                </td>
                <td>
                  {s.tracks > 0 ? (
                    <span className="pill">
                      {s.tracks === 1 ? "1 track" : `${s.tracks} tracks`}
                    </span>
                  ) : (
                    <span className="pill ok">No tracklist yet</span>
                  )}
                </td>
                <td className="act">
                  <a href={`${wikiBaseUrl}/wiki/${s.qid}`} target="_blank" rel="noreferrer">
                    Open on Wikidata ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {listed.length < singles.length && (
        <button type="button" className="show-all" onClick={() => setAll(true)}>
          Show all {singles.length} singles
        </button>
      )}
      {truncated && (
        <p className="sub artist-note">Only the first {singles.length} singles are listed.</p>
      )}
    </section>
  );
}

/** The id of an album's row, for a single's Taken from link to go to. */
function albumRowId(qid: string): string {
  return `album-${qid}`;
}

function WarnIcon() {
  return (
    <svg className="warn-icon" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l7 12.5H1z" />
      <path d="M8 6.2v3.6M8 11.8v.2" />
    </svg>
  );
}

function AlbumRow({ album: a, wikiBaseUrl }: { album: ArtistAlbum; wikiBaseUrl: string }) {
  const label = a.label ?? a.qid;
  const running = a.run?.status === "running";
  const added = a.tracks > 0 && a.run?.status === "done";
  // More than one is usually a mistake on the item: like the album section, suggest none.
  const releaseGroup = a.releaseGroups.length === 1 ? a.releaseGroups[0] : null;
  const runLink = a.run && (
    <>
      {a.run.mine ? (
        <Link href={`/?run=${a.run.id}`}>Open run</Link>
      ) : (
        <a href={a.run.editGroupUrl} target="_blank" rel="noreferrer">
          EditGroups ↗
        </a>
      )}
      <a href={`${wikiBaseUrl}/wiki/${a.qid}`} target="_blank" rel="noreferrer">
        Open on Wikidata ↗
      </a>
    </>
  );
  return (
    <tr id={albumRowId(a.qid)} className={a.tracks > 0 || running ? "taken" : undefined}>
      <td className="year" title={a.released ?? "No release date on Wikidata"}>
        {a.released ? a.released.slice(0, 4) : "—"}
      </td>
      <td>
        <span className="title">{label}</span>{" "}
        <a
          className="mono muted"
          href={`${wikiBaseUrl}/wiki/${a.qid}`}
          target="_blank"
          rel="noreferrer"
        >
          {a.qid}
        </a>
      </td>
      <td>
        <span className="pill">{a.type}</span>
      </td>
      <td>
        <span className="pills">
          {running ? (
            <span className="pill">A run is adding it</span>
          ) : added ? (
            <span className="pill done">Added with Discographer · {runDay(a.run!.createdAt)}</span>
          ) : a.tracks > 0 ? (
            <span className="pill">{a.tracks === 1 ? "1 track" : `${a.tracks} tracks`}</span>
          ) : (
            <span className="pill ok">No tracklist yet</span>
          )}
          {a.tracks > 0 && a.parts !== null && a.parts > a.tracks && (
            <span
              className="pill warn"
              title={`${a.tracks} listed, but its number of parts (P2635) says ${a.parts}`}
            >
              <WarnIcon />
              Expected {a.parts} tracks
            </span>
          )}
        </span>
      </td>
      <td className="act">
        {running || added ? (
          runLink
        ) : a.tracks > 0 ? (
          <a href={`${wikiBaseUrl}/wiki/${a.qid}`} target="_blank" rel="noreferrer">
            Open on Wikidata ↗
          </a>
        ) : (
          <Link
            className="use-link"
            href={`/?${new URLSearchParams(releaseGroup ? { album: a.qid, rg: releaseGroup } : { album: a.qid })}`}
            aria-label={`Add a tracklist to ${label}${releaseGroup ? " from MusicBrainz" : ""}`}
          >
            {releaseGroup && (
              <span className="mb-badge" aria-hidden="true">
                MB
              </span>
            )}
            Add tracklist
          </Link>
        )}
      </td>
    </tr>
  );
}
