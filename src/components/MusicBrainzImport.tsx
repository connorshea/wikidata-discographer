import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { api, FetchError } from "../lib/client.ts";
import { applyMbForm, type MbForm, parseMbInput, type ReleaseChoice } from "../lib/musicbrainz.ts";
import type { State } from "../lib/plan.ts";
import type { MusicBrainzReleaseGroupResponse, MusicBrainzResponse } from "../lib/api-types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const message = (err: unknown, what: string) =>
  err instanceof FetchError && err.status < 500
    ? err.message
    : `Couldn't load the ${what}. ${err instanceof Error ? err.message : ""}`.trim();

/** What the rest of the form can ask of the import. */
export interface MusicBrainzImportHandle {
  /**
   * Lists a release group's releases to pick one, as if its URL were pasted.
   * The release picked, or a release of that group pasted after, is loaded
   * onto `album`, an existing album with that release group.
   */
  loadReleaseGroup: (mbid: string, album: string) => void;
}

/** Loads a MusicBrainz release into the form, replacing what's there. */
export default function MusicBrainzImport({
  state,
  needsConfirm,
  onLoad,
  ref,
}: {
  state: State;
  needsConfirm: boolean;
  onLoad: (next: State) => void;
  ref?: Ref<MusicBrainzImportHandle>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A pasted release group's releases and the one picked.
  const [group, setGroup] = useState<{
    releases: ReleaseChoice[];
    total: number;
    picked: string;
  } | null>(null);
  // The existing album whose release group was loaded from elsewhere in the
  // form. It outlives the release list, since a release group with too many
  // releases to list asks for the release's URL instead. The server only
  // honors it for a release in that group.
  const albumFor = useRef<{ album: string; releaseGroup: string } | null>(null);
  // A release fetched and waiting on the user to confirm replacing the form.
  const [pending, setPending] = useState<MbForm | null>(null);
  // What the last load found, until the next one.
  const [loaded, setLoaded] = useState<MbForm | null>(null);
  const pickId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // Set when a release group is loaded from elsewhere in the form, to move
  // focus to its releases once they're listed.
  const focusPick = useRef(false);

  const apply = (form: MbForm) => {
    onLoad(applyMbForm(state, form));
    setLoaded(form);
    setPending(null);
    setGroup(null);
    setInput("");
    albumFor.current = null;
  };

  // The latest request. The album's suggestion can start one while another
  // is loading, and only the latest may change the form.
  const latest = useRef(0);

  const run = async (what: string, fn: (current: () => boolean) => Promise<void>) => {
    const id = ++latest.current;
    const current = () => latest.current === id;
    setError("");
    setLoaded(null);
    setBusy(true);
    try {
      await fn(current);
    } catch (err) {
      if (current()) setError(message(err, what));
    } finally {
      if (current()) setBusy(false);
    }
  };

  const loadRelease = (id: string) =>
    run("release", async (current) => {
      const query = albumFor.current ? `?${new URLSearchParams(albumFor.current)}` : "";
      const { form } = await api<MusicBrainzResponse>(`/api/musicbrainz/release/${id}${query}`);
      if (!current()) return;
      if (needsConfirm) setPending(form);
      else apply(form);
    });

  const loadGroup = (id: string) =>
    run("release group", async (current) => {
      const r = await api<MusicBrainzReleaseGroupResponse>(`/api/musicbrainz/release-group/${id}`);
      if (!current()) return;
      setGroup({ ...r, picked: r.releases[0].id });
    });

  const submit = () => {
    const parsed = parseMbInput(input);
    if (!parsed.ok) return setError(parsed.error);
    focusPick.current = false;
    setGroup(null);
    if (parsed.kind === "release") return loadRelease(parsed.id);
    // Another release group isn't the album's.
    if (parsed.id !== albumFor.current?.releaseGroup) albumFor.current = null;
    return loadGroup(parsed.id);
  };

  useImperativeHandle(ref, () => ({
    loadReleaseGroup: (mbid, album) => {
      setInput(`https://musicbrainz.org/release-group/${mbid}`);
      setGroup(null);
      focusPick.current = true;
      albumFor.current = { album, releaseGroup: mbid.toLowerCase() };
      sectionRef.current?.scrollIntoView({ block: "start" });
      void loadGroup(mbid);
    },
  }));

  useEffect(() => {
    if (!group || !focusPick.current) return;
    focusPick.current = false;
    document.getElementById(pickId)?.focus({ preventScroll: true });
  }, [group, pickId]);

  return (
    <section className="block" ref={sectionRef}>
      <h2>Start from MusicBrainz</h2>
      <p className="hint">
        Paste a MusicBrainz release or release group to fill in the album, discs and performers. A
        release group asks which of its releases has the tracklist you want. Artists, compositions
        and tracks already on Wikidata with the same MusicBrainz IDs are filled in too. Check
        everything before you run it.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          type="text"
          spellCheck={false}
          className="mb-input"
          placeholder="https://musicbrainz.org/release-group/…"
          aria-label="MusicBrainz release or release group URL"
          aria-invalid={!!error}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setGroup(null);
          }}
        />
        <button
          type="submit"
          className={group ? "ghost" : undefined}
          disabled={busy || !input.trim()}
        >
          {busy && !group ? "Loading…" : "Load"}
        </button>
      </form>
      {group && (
        <form
          className="mb-pick"
          onSubmit={(e) => {
            e.preventDefault();
            void loadRelease(group.picked);
          }}
        >
          <label className="f" htmlFor={pickId}>
            Release
          </label>
          <div className="row">
            <select
              id={pickId}
              className="mb-input"
              value={group.picked}
              onChange={(e) => setGroup({ ...group, picked: e.target.value })}
            >
              {group.releases.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i === 0 ? `${r.label} (suggested)` : r.label}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy}>
              {busy ? "Loading…" : "Load this release"}
            </button>
          </div>
          <span className="sub">
            {group.total > group.releases.length
              ? `${group.releases.length} of ${group.total} releases. If yours isn't listed, paste its release URL.`
              : `${group.total} release${group.total === 1 ? "" : "s"}. The suggestion is the earliest official plain edition, digital or CD if there is one.`}
          </span>
        </form>
      )}
      {error && <p className="msg err">{error}</p>}
      {loaded && (
        <>
          <p className="msg ok">{loaded.summary}</p>
          {loaded.notes.map((n) => (
            <p key={n} className="msg warn">
              {n}
            </p>
          ))}
        </>
      )}
      <ConfirmDialog
        confirm={
          pending && {
            title: `Replace the form with “${pending.album.title}”?`,
            body: "This replaces the album, tracklists and performers you've entered with the MusicBrainz release. Your item settings are kept, apart from the publication date and language. It can't be undone.",
            action: "Replace",
          }
        }
        onConfirm={() => pending && apply(pending)}
        onClose={() => setPending(null)}
      />
    </section>
  );
}
