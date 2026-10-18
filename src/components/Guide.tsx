// The user guide (/guide): how to use the form, and the modelling rules its
// edits follow on Wikidata.
import type { ReactNode } from "react";
import { Link } from "wouter";

/** A section still to be written, shown as such on the page. */
function Todo({ children }: { children: ReactNode }) {
  return <p className="guide-todo">To be written · {children}</p>;
}

const SECTIONS = [
  { id: "before-you-start", title: "Before you start" },
  { id: "starting-point", title: "Picking a starting point" },
  { id: "tracks", title: "Tracks and compositions" },
  { id: "singles", title: "Singles" },
  { id: "performers", title: "Performers" },
  { id: "matches", title: "Possible matches" },
  { id: "running", title: "Running the edits" },
];

export default function Guide() {
  return (
    <article className="block guide">
      <h2>User guide</h2>
      <p className="hint">
        How to add an album's tracklist to Wikidata with Discographer, and the rules its edits
        follow.
      </p>

      <nav aria-label="Contents">
        <ol className="guide-toc">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="before-you-start">
        <h3>Before you start</h3>
        <Todo>logging in with Wikimedia, which accounts can make edits, and edit pacing.</Todo>
      </section>

      <section id="starting-point">
        <h3>Picking a starting point</h3>
        <Todo>
          importing from MusicBrainz, adding a tracklist to an existing album item, and creating a
          new album from scratch.
        </Todo>
      </section>

      <section id="tracks">
        <h3>Tracks and compositions</h3>
        <Todo>
          what the tool creates for each track, how recordings relate to compositions, and when to
          reuse an existing item.
        </Todo>
      </section>

      <section id="singles">
        <h3>Singles</h3>
        <p>
          Only attach a single to a track when that single was actually taken from this album. A
          single released from a different album, or one shared across several distinct releases
          such as a deluxe edition or a later reissue, doesn't belong on this tracklist.
        </p>
        <Todo>examples, how to handle reissues and compilations, and what to do instead.</Todo>
      </section>

      <section id="performers">
        <h3>Performers</h3>
        <Todo>album artists versus per-track performers, and featured artists.</Todo>
      </section>

      <section id="matches">
        <h3>Possible matches</h3>
        <Todo>
          how the tool finds existing items that may be the same track, and how to review them.
        </Todo>
      </section>

      <section id="running">
        <h3>Running the edits</h3>
        <Todo>
          the checklist, what happens during a run, recovering from a failed or interrupted run, and
          finding the result on the <Link href="/albums">album list</Link>.
        </Todo>
      </section>
    </article>
  );
}
