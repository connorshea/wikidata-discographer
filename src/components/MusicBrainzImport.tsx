import { useState } from "react";
import { api, FetchError } from "../lib/client.ts";
import { applyMbForm, type MbForm, parseReleaseInput } from "../lib/musicbrainz.ts";
import type { State } from "../lib/plan.ts";
import type { MusicBrainzResponse } from "../lib/api-types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** Loads a MusicBrainz release into the form, replacing what's there. */
export default function MusicBrainzImport({
  state,
  needsConfirm,
  onLoad,
}: {
  state: State;
  needsConfirm: boolean;
  onLoad: (next: State) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A release fetched and waiting on the user to confirm replacing the form.
  const [pending, setPending] = useState<MbForm | null>(null);
  // What the last load found, until the next one.
  const [loaded, setLoaded] = useState<MbForm | null>(null);

  const apply = (form: MbForm) => {
    onLoad(applyMbForm(state, form));
    setLoaded(form);
    setPending(null);
    setInput("");
  };

  const load = async () => {
    const parsed = parseReleaseInput(input);
    if (!parsed.ok) return setError(parsed.error);
    setError("");
    setLoaded(null);
    setBusy(true);
    try {
      const { form } = await api<MusicBrainzResponse>(`/api/musicbrainz/release/${parsed.id}`);
      if (needsConfirm) setPending(form);
      else apply(form);
    } catch (err) {
      setError(
        err instanceof FetchError && err.status < 500
          ? err.message
          : `Couldn't load the release. ${err instanceof Error ? err.message : ""}`.trim(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="block">
      <h2>Start from MusicBrainz</h2>
      <p className="hint">
        Paste a MusicBrainz release to fill in the album, discs and performers. Artists,
        compositions and tracks already on Wikidata with the same MusicBrainz IDs are filled in too.
        Check everything before you run it.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          type="text"
          spellCheck={false}
          className="mb-input"
          placeholder="https://musicbrainz.org/release/…"
          aria-label="MusicBrainz release URL or ID"
          aria-invalid={!!error}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? "Loading…" : "Load the release"}
        </button>
      </form>
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
