// Fills the form from a MusicBrainz release. The server fetches the release
// (server/musicbrainz.ts), looks up its MusicBrainz IDs in the mirror, and
// runs `releaseToForm` to turn both into form values the client loads.
//
// The tracklist belongs to a release, not a release group, which can have
// many releases with different tracks. A pasted release group lists its
// releases (`releaseChoices`) for the user to pick one, best guess first.
import { ALBUM_FORMS, ALBUM_TYPES, NO_LINGUISTIC_CONTENT, PARTS, splitArtists } from "./plan.ts";
import type { AlbumState, Disc, MbRowIds, State } from "./plan.ts";
import { ALBUM_ID_FIELDS, ISRC_PATTERN } from "./music.ts";
import { coerceState, emptyDisc } from "./state.ts";

const MBID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
const MBID_RE = new RegExp(`^${MBID}$`, "i");
const URL_RE = new RegExp(
  String.raw`musicbrainz\.org/(release|release-group|recording|artist|work)/(${MBID})`,
  "i",
);

export type ParsedMbInput =
  | { ok: true; kind: "release" | "release-group"; id: string }
  | { ok: false; error: string };

/** A pasted release or release group URL, or a bare MBID (taken as a release). */
export function parseMbInput(raw: string): ParsedMbInput {
  const s = raw.trim();
  if (MBID_RE.test(s)) return { ok: true, kind: "release", id: s.toLowerCase() };
  const m = URL_RE.exec(s);
  if (!m) return { ok: false, error: "Paste a MusicBrainz release or release group URL." };
  const kind = m[1].toLowerCase();
  if (kind !== "release" && kind !== "release-group")
    return { ok: false, error: `That's a MusicBrainz ${kind}, not a release or release group.` };
  return { ok: true, kind, id: m[2].toLowerCase() };
}

// ---------------------------------------------------------------------------
// A release group's releases, from
//   /ws/2/release?release-group=<mbid>&inc=media
// ---------------------------------------------------------------------------

export interface MbReleaseListing {
  id: string;
  title: string;
  status: string | null;
  date?: string;
  country?: string | null;
  disambiguation?: string;
  media: { format: string | null; "track-count": number }[];
}

/** A release to choose from, with a one-line description. */
export interface ReleaseChoice {
  id: string;
  label: string;
}

// Formats to suggest, best first. Anything else comes after.
const FORMAT_RANK = [/digital/i, /\bCD\b/, /vinyl/i];

/** How many of each format, e.g. "2×CD" or "CD + DVD-Video". */
function formats(media: MbReleaseListing["media"]): string {
  const counts = new Map<string, number>();
  for (const m of media)
    counts.set(m.format ?? "Unknown format", (counts.get(m.format ?? "Unknown format") ?? 0) + 1);
  return [...counts].map(([f, n]) => (n > 1 ? `${n}×${f}` : f)).join(" + ");
}

/**
 * A release group's releases, best guess first: official ones, from the
 * earliest year, a plain edition (no disambiguation such as "deluxe" or
 * "Dolby Atmos mix"), with the most common track count, digital or CD or
 * vinyl, then the earliest date. Ties keep MusicBrainz's order.
 */
export function releaseChoices(releases: MbReleaseListing[]): ReleaseChoice[] {
  const tracks = (r: MbReleaseListing) => r.media.reduce((n, m) => n + m["track-count"], 0);
  const counts = new Map<number, number>();
  for (const r of releases) counts.set(tracks(r), (counts.get(tracks(r)) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const titles = new Map<string, number>();
  for (const r of releases) titles.set(r.title, (titles.get(r.title) ?? 0) + 1);
  const usualTitle = [...titles].sort((a, b) => b[1] - a[1])[0]?.[0];

  const key = (r: MbReleaseListing): (number | string)[] => {
    const format = Math.min(
      ...r.media.map((m) => {
        const i = FORMAT_RANK.findIndex((re) => re.test(m.format ?? ""));
        return i < 0 ? FORMAT_RANK.length : i;
      }),
    );
    return [
      r.status === "Official" ? 0 : 1,
      r.date ? 0 : 1,
      r.date?.slice(0, 4) ?? "",
      r.disambiguation ? 1 : 0,
      tracks(r) === usual ? 0 : 1,
      format,
      // A date without a month or day sorts after the exact ones in its year.
      (r.date ?? "").padEnd(10, "~"),
    ];
  };
  const compare = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  };
  return releases
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => compare(a.k, b.k) || a.i - b.i)
    .map(({ r }) => {
      const n = tracks(r);
      const perDisc =
        r.media.length > 1 ? ` (${r.media.map((m) => m["track-count"]).join(" + ")})` : "";
      const parts = [
        r.title !== usualTitle && r.title,
        r.date || "No date",
        r.country,
        formats(r.media),
        `${plural(n, "track")}${perDisc}`,
        r.disambiguation,
        r.status !== "Official" && (r.status ?? "No status"),
      ];
      return { id: r.id, label: parts.filter(Boolean).join(" · ") };
    });
}

// ---------------------------------------------------------------------------
// The parts of MusicBrainz's release JSON the import reads. The lookup is
//   /ws/2/release/<mbid>?inc=recordings+artist-credits+release-groups+
//     work-rels+recording-level-rels+url-rels+release-group-level-rels+isrcs
// ---------------------------------------------------------------------------

export interface MbArtistCredit {
  name: string;
  joinphrase: string;
  artist: { id: string; name: string };
}

export interface MbRelation {
  type: string;
  "target-type": string;
  url?: { resource: string };
  work?: { id: string; title: string };
}

export interface MbTrack {
  position: number;
  title: string;
  length: number | null;
  "artist-credit": MbArtistCredit[];
  recording: { id: string; isrcs?: string[]; relations?: MbRelation[] };
}

export interface MbMedium {
  position: number;
  format: string | null;
  tracks?: MbTrack[];
}

export interface MbRelease {
  id: string;
  title: string;
  date?: string;
  "text-representation"?: { language: string | null };
  "artist-credit": MbArtistCredit[];
  "release-group": {
    id: string;
    "primary-type": string | null;
    "secondary-types"?: string[];
    "first-release-date"?: string;
    relations?: MbRelation[];
  };
  relations?: MbRelation[];
  media: MbMedium[];
}

/** The MusicBrainz IDs on a release that the mirror might know, to look up before `releaseToForm`. */
export function releaseIds(release: MbRelease) {
  const tracks = release.media.flatMap((m) => m.tracks ?? []);
  const credits = [release["artist-credit"], ...tracks.map((t) => t["artist-credit"])].flat();
  return {
    releaseGroup: release["release-group"].id,
    artists: [...new Set(credits.map((c) => c.artist.id))],
    recordings: [...new Set(tracks.map((t) => t.recording.id))],
    works: [...new Set(tracks.flatMap((t) => workOf(t) ?? []))],
    spotifyTracks: [...new Set(tracks.flatMap(spotifyOf))],
  };
}

/** The distinct Spotify track IDs a recording links to. */
function spotifyLinks(t: MbTrack): string[] {
  const ids = (t.recording.relations ?? []).flatMap(
    (r) =>
      /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([0-9A-Za-z]{22})/.exec(
        r.url?.resource ?? "",
      )?.[1] ?? [],
  );
  return [...new Set(ids)];
}

/**
 * A recording's Spotify track ID, if it links exactly one. Several usually
 * means one per Spotify release the recording is on, and there's no telling
 * which is this album's.
 */
function spotifyOf(t: MbTrack): string[] {
  const ids = spotifyLinks(t);
  return ids.length === 1 ? ids : [];
}

/** Items in the mirror with these MusicBrainz IDs, MBID → QID. */
export interface MbLookups {
  /** The album: by P436 release group ID, or the release group's Wikidata link. */
  albumQid?: string;
  /** P434 artist ID. */
  artists: Record<string, string>;
  /** P4404 recording ID → track. */
  recordings: Record<string, string>;
  /** P435 work ID → composition. */
  works: Record<string, string>;
  /**
   * Recording, work and Spotify track IDs some item in the mirror already
   * has, however many. They aren't added to new items, which would duplicate them.
   */
  taken: string[];
}

/** What the import fills in. Settings other than the date and language are left as they are. */
export interface MbForm {
  album: AlbumState;
  artists: Record<string, string>;
  discs: Disc[];
  date: string;
  p407: string;
  /** Things the user should check, in plain sentences. */
  notes: string[];
  summary: string;
}

// ISO 639-3, as MusicBrainz gives a release's language, → the languages the form lists.
const LANGUAGES: Record<string, string> = {
  ara: "Q13955",
  yue: "Q9186",
  ces: "Q9056",
  dan: "Q9035",
  nld: "Q7411",
  eng: "Q1860",
  fra: "Q150",
  deu: "Q188",
  heb: "Q9288",
  hin: "Q1568",
  ita: "Q652",
  jpn: "Q5287",
  kor: "Q9176",
  lat: "Q397",
  cmn: "Q9192",
  nor: "Q9043",
  nob: "Q9043",
  pol: "Q809",
  por: "Q5146",
  rus: "Q7737",
  spa: "Q1321",
  swe: "Q9027",
  tgl: "Q34057",
  tur: "Q256",
  zxx: NO_LINGUISTIC_CONTENT,
};

const PRIMARY_TYPES: Record<string, (typeof ALBUM_TYPES)[number][0]> = {
  Album: "Q482994",
  EP: "Q169930",
};

const SECONDARY_FORMS: Record<string, (typeof ALBUM_FORMS)[number][0]> = {
  Live: "Q209939",
  Compilation: "Q222910",
  Soundtrack: "Q4176708",
  Remix: "Q963099",
};

const STUDIO_ALBUM = "Q208569";

const partOptions = (group: string) => PARTS.find(([g]) => g === group)![1].map(([q]) => q);
const CD_PARTS = partOptions("Compact disc");
const LP_PARTS = partOptions("Vinyl disc");

/** A track's composition: the work its recording is a performance of, when there's just one. */
function workOf(t: MbTrack): string | undefined {
  const works = (t.recording.relations ?? []).filter(
    (r) => r["target-type"] === "work" && r.type === "performance" && r.work,
  );
  return works.length === 1 ? works[0].work!.id : undefined;
}

/**
 * An artist credit written so the tracklist parser splits it back into the
 * same artists: MusicBrainz's join phrases where the parser understands them
 * (", ", " & ", " feat. "), and ", " for anything else (" x ", " and ", " with ").
 */
export function creditText(credit: MbArtistCredit[]): string {
  return credit
    .map((c, i) => {
      if (i === credit.length - 1) return c.name;
      const split = splitArtists(`X${c.joinphrase}Y`, true);
      return c.name + (split.length === 2 ? c.joinphrase : ", ");
    })
    .join("");
}

/** A MusicBrainz length in milliseconds as the whole seconds the tracklist shows. */
const seconds = (ms: number) => Math.round(ms / 1000);

const duration = (ms: number) => {
  const s = seconds(ms);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** The Wikidata item a MusicBrainz entity's relations link to, if any. */
export function wikidataLink(relations: MbRelation[] | undefined): string | undefined {
  for (const r of relations ?? []) {
    const m = /wikidata\.org\/wiki\/(Q\d+)$/.exec(r.url?.resource ?? "");
    if (r.type === "wikidata" && m) return m[1];
  }
  return undefined;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function releaseToForm(
  release: MbRelease,
  lookups: MbLookups,
  /** The day it was fetched, YYYY-MM-DD, for references. */
  retrieved = new Date().toISOString().slice(0, 10),
): MbForm {
  const notes: string[] = [];
  const rg = release["release-group"];

  // Artists, keyed by the name they're credited as, as the Performers table is.
  const artists: Record<string, string> = {};
  const nameTroubles = new Set<string>();
  const addCredit = (credit: MbArtistCredit[]) => {
    for (const c of credit) {
      if (splitArtists(c.name, true).length > 1 || /\s[-–—]\s/.test(c.name))
        nameTroubles.add(c.name);
      const qid = lookups.artists[c.artist.id];
      if (qid && !(c.name in artists)) artists[c.name] = qid;
    }
  };
  addCredit(release["artist-credit"]);

  // Discs: one per medium with tracks.
  const media = release.media.filter((m) => m.tracks?.length);
  if (media.length < release.media.length)
    notes.push(
      `${plural(release.media.length - media.length, "medium has", "media have")} no tracks on MusicBrainz and ${release.media.length - media.length === 1 ? "was" : "were"} left out.`,
    );
  const vinyl = media.every((m) => /vinyl|"/i.test(m.format ?? ""));
  const parts = vinyl ? LP_PARTS : CD_PARTS;
  let missingLength = 0;
  let comps = 0;
  let tracks = 0;
  let manySpotify = 0;
  const taken = new Set(lookups.taken);
  const toAdd = { recordings: 0, works: 0, isrcs: 0, spotify: 0, refs: 0 };
  const discs = media.map((m, i): Disc => {
    const disc = emptyDisc();
    if (media.length > 1) {
      disc.part = parts[i] ?? "";
      if (!disc.part) notes.push(`Disc ${i + 1} has no part. Choose one under Discs.`);
    }
    disc.text = m
      .tracks!.map((t) => {
        addCredit(t["artist-credit"]);
        const work = workOf(t);
        if (work && lookups.works[work]) {
          disc.comp[t.position] = lookups.works[work];
          comps++;
        }
        if (lookups.recordings[t.recording.id]) {
          disc.track[t.position] = lookups.recordings[t.recording.id];
          tracks++;
        }
        const ids: MbRowIds = {
          title: t.title.trim(),
          recording: taken.has(t.recording.id) ? "" : t.recording.id,
          work: work && !taken.has(work) ? work : "",
          isrcs: [...new Set((t.recording.isrcs ?? []).filter((v) => ISRC_PATTERN.test(v)))],
          spotify: spotifyOf(t).filter((v) => !taken.has(v)),
          length:
            t.length === null
              ? null
              : { seconds: seconds(t.length), recording: t.recording.id, retrieved },
        };
        if (ids.recording || ids.work || ids.isrcs.length || ids.spotify.length || ids.length) {
          disc.mb[t.position] = ids;
          if (!disc.track[t.position]) {
            toAdd.recordings += ids.recording ? 1 : 0;
            toAdd.isrcs += ids.isrcs.length;
            toAdd.spotify += ids.spotify.length;
            if (spotifyLinks(t).length > 1) manySpotify++;
            toAdd.refs += ids.length ? 1 : 0;
          }
          if (!disc.comp[t.position]) toAdd.works += ids.work ? 1 : 0;
        }
        if (t.length === null) missingLength++;
        const len = t.length === null ? "" : ` (${duration(t.length)})`;
        return `${t.position}. ${t.title} - ${creditText(t["artist-credit"])}${len}`;
      })
      .join("\n");
    return disc;
  });
  if (missingLength)
    notes.push(
      `${plural(missingLength, "track has", "tracks have")} no length on MusicBrainz, so ${missingLength === 1 ? "it gets" : "they get"} no duration.`,
    );
  if (manySpotify)
    notes.push(
      `${plural(manySpotify, "track links", "tracks link")} more than one Spotify track on MusicBrainz, so ${manySpotify === 1 ? "it gets" : "they get"} no Spotify track ID.`,
    );
  for (const name of nameTroubles)
    notes.push(
      `“${name}” has a comma, ampersand, “feat.” or dash in their name, so the tracklist may split it into several artists. Check the Performers table, or turn off splitting artists in Item settings.`,
    );

  const type = PRIMARY_TYPES[rg["primary-type"] ?? ""];
  if (!type)
    notes.push(
      `MusicBrainz lists this as ${rg["primary-type"] ? `a ${rg["primary-type"]}` : "having no type"}, not an album or EP. Check the album's type.`,
    );
  const secondary = rg["secondary-types"] ?? [];
  const form = secondary.length
    ? (secondary.map((s) => SECONDARY_FORMS[s]).find(Boolean) ?? "")
    : STUDIO_ALBUM;

  const albumQid = lookups.albumQid;
  const ids: AlbumState["ids"] = { spotify: "", musicbrainz: rg.id, appleMusic: "", discogs: "" };
  for (const f of ALBUM_ID_FIELDS) {
    if (f.key === "musicbrainz") continue;
    // A Discogs master is the album as a whole, so MusicBrainz links it from
    // the release group. A /release/ link on the release is one edition and is skipped.
    const relations = f.key === "discogs" ? rg.relations : release.relations;
    const linked = [
      ...new Set(
        (relations ?? []).flatMap((r) => f.fromUrl.exec(r.url?.resource ?? "")?.[1] ?? []),
      ),
    ];
    if (f.key === "discogs" && linked.length > 1) {
      if (!albumQid)
        notes.push(
          `The release group links ${linked.length} Discogs masters, so none was filled in. Add the right one under Album.`,
        );
    } else ids[f.key] = linked[0] ?? "";
  }
  const linkedIds = ALBUM_ID_FIELDS.filter((f) => f.key !== "musicbrainz" && ids[f.key]).map(
    (f) => f.label,
  );
  const language = release["text-representation"]?.language ?? "";
  const p407 = LANGUAGES[language] ?? "";
  if (language && !p407 && language !== "mul")
    notes.push(
      `The release's language (${language}) isn't one the form lists. Set the language of the work in Item settings.`,
    );

  const songs = discs.reduce((n, _, i) => n + (media[i].tracks?.length ?? 0), 0);
  const found = [
    Object.keys(artists).length && plural(Object.keys(artists).length, "artist"),
    comps && plural(comps, "composition"),
    tracks && plural(tracks, "track"),
  ].filter(Boolean);
  const summary =
    `Loaded ${plural(discs.length, "disc")} and ${plural(songs, "track")}. ` +
    (albumQid ? `The album is already on Wikidata as ${albumQid}. ` : "") +
    (!albumQid && linkedIds.length
      ? `The new album gets the ${joinList(linkedIds)} MusicBrainz links to. `
      : "") +
    (found.length
      ? `Found ${joinList(found as string[])} already on Wikidata by their MusicBrainz IDs.`
      : "Found nothing else already on Wikidata by its MusicBrainz ID.") +
    idsSummary(toAdd) +
    (toAdd.refs
      ? ` ${toAdd.refs === 1 ? "The new track's duration gets" : `${toAdd.refs} new tracks' durations get`} a MusicBrainz reference, if that's on in Item settings.`
      : "");

  return {
    album: {
      mode: albumQid ? "existing" : "create",
      qid: albumQid ?? "",
      title: release.title,
      artists: creditText(release["artist-credit"]),
      type: type ?? "Q482994",
      form,
      ids,
    },
    artists,
    discs: discs.length ? discs : [emptyDisc()],
    date: rg["first-release-date"] || release.date || "",
    p407,
    notes,
    summary,
  };
}

/** What the import adds to the items the run creates, as a sentence. */
function idsSummary(n: { recordings: number; works: number; isrcs: number; spotify: number }) {
  const parts = [
    n.recordings && plural(n.recordings, "recording ID"),
    n.isrcs && plural(n.isrcs, "ISRC"),
    n.spotify && plural(n.spotify, "Spotify track ID"),
  ].filter(Boolean) as string[];
  const tracks = parts.length ? `New tracks get ${joinList(parts)}` : "";
  const works = n.works
    ? `${plural(n.works, "new composition")} ${n.works === 1 ? "gets its" : "get their"} work ID`
    : "";
  if (!tracks && !works) return "";
  return ` ${[tracks, works].filter(Boolean).join(", and ")}, if adding identifiers is on in Item settings.`;
}

const joinList = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** The form filled from `form`, keeping the settings other than the date and language. */
export function applyMbForm(state: State, form: MbForm): State {
  return coerceState({
    settings: { ...state.settings, date: form.date, p407: form.p407, p407Custom: false },
    album: form.album,
    artists: form.artists,
    discs: form.discs,
  });
}
