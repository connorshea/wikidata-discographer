// Fills the form from a MusicBrainz release. The server fetches the release
// (server/musicbrainz.ts), looks up its MusicBrainz IDs in the mirror, and
// runs `releaseToForm` to turn both into form values the client loads.
//
// The tracklist belongs to a release, not a release group, which can have
// many releases with different tracks. A pasted release group lists its
// releases (`releaseChoices`) for the user to pick one, best guess first.
import {
  ALBUM_FORMS,
  ALBUM_TYPES,
  EP_CLASS,
  MB_ATTRIBUTES,
  type MbAttribute,
  NO_LINGUISTIC_CONTENT,
  PARTS,
  parseDate,
  STUDIO_ALBUM,
} from "./plan.ts";
import type { AlbumMb, AlbumState, Disc, MbRowIds, MbWriter, State, Track } from "./plan.ts";
import { ALBUM_ID_FIELDS, ISRC_PATTERN, ISWC_PATTERN, type MusicKind } from "./music.ts";
import { coerceState, emptyDisc } from "./state.ts";

const MBID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
export const MBID_RE = new RegExp(`^${MBID}$`, "i");
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
//     work-rels+recording-level-rels+work-level-rels+artist-rels+url-rels+
//     release-group-level-rels+isrcs
// work-level-rels and artist-rels bring each work's own artist relations,
// its composers and lyricists among them.
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
  artist?: { id: string; name: string };
  work?: { id: string; title: string; iswcs?: string[]; relations?: MbRelation[] };
  /** What the relation says about it, e.g. "live" or "cover" on a recording's performance of a work. */
  attributes?: string[];
}

export interface MbTrack {
  position: number;
  title: string;
  length: number | null;
  "artist-credit": MbArtistCredit[];
  recording: { id: string; title: string; isrcs?: string[]; relations?: MbRelation[] };
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
    title: string;
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
    artists: [
      ...new Set([
        ...credits.map((c) => c.artist.id),
        ...tracks.flatMap((t) => {
          const w = writersOf(t);
          return [...w.composers, ...w.lyricists].map((a) => a.id);
        }),
      ]),
    ],
    recordings: [...new Set(tracks.map((t) => t.recording.id))],
    works: [...new Set(tracks.flatMap((t) => workOf(t) ?? []))],
    iswcs: [...new Set(tracks.flatMap((t) => iswcsOf(t)))],
    spotifyTracks: [...new Set(tracks.flatMap((t) => trackLinkOf(t, "spotify")))],
    appleMusicTracks: [...new Set(tracks.flatMap((t) => trackLinkOf(t, "appleMusic")))],
    deezerTracks: [...new Set(tracks.flatMap((t) => trackLinkOf(t, "deezer")))],
    tidalTracks: [...new Set(tracks.flatMap((t) => trackLinkOf(t, "tidal")))],
  };
}

/** The streaming services a recording's links give a track ID for. */
const TRACK_LINKS = {
  spotify: {
    fromUrl: /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([0-9A-Za-z]{22})/,
    service: "Spotify",
    label: "Spotify track ID",
  },
  // MusicBrainz rewrites older Apple links on recordings to this form.
  appleMusic: {
    fromUrl: /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\/(\d+)$/,
    service: "Apple Music",
    label: "Apple Music track ID",
  },
  deezer: {
    fromUrl: /^https:\/\/www\.deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)$/,
    service: "Deezer",
    label: "Deezer track ID",
  },
  tidal: {
    fromUrl: /^https:\/\/(?:listen\.)?tidal\.com\/(?:browse\/)?track\/(\d+)$/,
    service: "Tidal",
    label: "Tidal track ID",
  },
} as const;
type TrackLinkKey = keyof typeof TRACK_LINKS;

/** The distinct IDs of one service a recording links to. */
function trackLinks(t: MbTrack, key: TrackLinkKey): string[] {
  const ids = (t.recording.relations ?? []).flatMap(
    (r) => TRACK_LINKS[key].fromUrl.exec(r.url?.resource ?? "")?.[1] ?? [],
  );
  return [...new Set(ids)];
}

/**
 * A recording's ID on a service, if it links exactly one. Several usually
 * means one per release on that service the recording is on, and there's no
 * telling which is this album's.
 */
function trackLinkOf(t: MbTrack, key: TrackLinkKey): string[] {
  const ids = trackLinks(t, key);
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
  /** P1827 ISWC → composition, for a work no composition has the work ID of. */
  iswcs?: Record<string, string>;
  /**
   * Recording, work and streaming track IDs and ISWCs some item in the mirror already
   * has, however many. They aren't added to new items, which would duplicate them.
   * A work ID only counts when a composition has it.
   */
  taken: string[];
  /** P435 work ID → items that have it but aren't compositions, usually singles. */
  misplacedWorks?: Record<string, { qid: string; kind: MusicKind }[]>;
}

const KIND_NOUNS: Record<MusicKind, string> = {
  artist: "artist",
  album: "album",
  ep: "EP",
  single: "single",
  work: "composition",
  track: "track",
};

/** An identifier the import adds, and to how many items. */
export interface MbIdCount {
  label: string;
  n: number;
}

/** What a load found and filled in, for the report under the start bar. */
export interface MbReport {
  /** The MusicBrainz release it was loaded from. */
  release: string;
  /** Items on Wikidata with a work ID only a composition should have. */
  misplaced: {
    qid: string;
    /** What the item is, as a noun: "single". */
    kind: string;
    /** The title of the track whose work ID it has. */
    title: string;
    /** No composition has the work ID, so the new one gets it. */
    newComp: boolean;
  }[];
  /** By streaming service, the new tracks that link more than one track on it, so get none of its IDs. */
  severalLinks: { service: string; titles: string[] }[];
  /** How many tracks the run creates, rather than reusing one already on Wikidata. */
  newTracks: number;
  /** The album's identifiers left off, as the release or release group links more than one. */
  severalAlbumLinks: { from: "release" | "release group"; n: number; what: string }[];
  /** Items already on Wikidata, found by their MusicBrainz IDs. */
  found: { album: string | null; artists: number; compositions: number; tracks: number };
  /** The identifiers each kind of new item gets. */
  added: { album: string[]; tracks: MbIdCount[]; compositions: MbIdCount[] };
  /**
   * The MusicBrainz IDs the tracks and compositions found on Wikidata get, with Link
   * reused items on, unless they have one already. Those found by the ID have it.
   */
  extended: { tracks: MbIdCount[]; compositions: MbIdCount[] };
  /** What gets a MusicBrainz reference: "durations", "ISRCs". */
  references: string[];
  /** Things the user should check in the form, in plain sentences. */
  notes: string[];
}

/** What the import fills in. Settings other than the date and language are left as they are. */
export interface MbForm {
  album: AlbumState;
  artists: Record<string, string>;
  discs: Disc[];
  date: string;
  p407: string;
  report: MbReport;
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

/** What a release or release group links more than one of, for the note saying none was filled in. */
const SEVERAL_ALBUM_LINKS = {
  spotify: "Spotify albums",
  appleMusic: "Apple Music albums",
  deezer: "Deezer albums",
  tidal: "Tidal albums",
  allmusic: "AllMusic albums",
  discogs: "Discogs masters",
} as const;

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

const partOptions = (group: string) => PARTS.find(([g]) => g === group)![1].map(([q]) => q);
const CD_PARTS = partOptions("Compact disc");
const LP_PARTS = partOptions("Vinyl disc");

/** A track's composition: the work its recording is a performance of, when there's just one. */
function workOf(t: MbTrack): string | undefined {
  return theWork(t)?.id;
}

function theWork(t: MbTrack) {
  return performance(t)?.work;
}

/** The recording's performance relation to its work, when it has just one. */
function performance(t: MbTrack) {
  const works = performances(t);
  return works.length === 1 ? works[0] : undefined;
}

/** The recording's performance relations to works. */
function performances(t: MbTrack) {
  return (t.recording.relations ?? []).filter(
    (r) => r["target-type"] === "work" && r.type === "performance" && r.work,
  );
}

/**
 * What a track's performance relations say about the recording, of the attributes the form
 * reads. A medley performs several works, so an attribute counts when every one of them has it.
 */
function attributesOf(t: MbTrack): MbAttribute[] {
  const rels = performances(t);
  return MB_ATTRIBUTES.filter((a) => rels.length && rels.every((r) => r.attributes?.includes(a)));
}

/** The ISWCs MusicBrainz has for a track's composition, as `workOf` picks it. */
function iswcsOf(t: MbTrack): string[] {
  return [...new Set((theWork(t)?.iswcs ?? []).filter((v) => ISWC_PATTERN.test(v)))];
}

/**
 * The work's relation types that say who wrote what. `writer` doesn't say whether
 * they wrote the music, the words or both, so it's left out rather than guessed.
 */
const WRITER_ROLES: Record<string, "composers" | "lyricists"> = {
  composer: "composers",
  lyricist: "lyricists",
};

/** The composers and lyricists of a track's composition, as `workOf` picks it, each once. */
function writersOf(t: MbTrack): { composers: MbWriter[]; lyricists: MbWriter[] } {
  const out = { composers: new Map<string, MbWriter>(), lyricists: new Map<string, MbWriter>() };
  for (const r of theWork(t)?.relations ?? []) {
    const role = Object.hasOwn(WRITER_ROLES, r.type) ? WRITER_ROLES[r.type] : undefined;
    const name = r.artist?.name.trim();
    if (role && r["target-type"] === "artist" && r.artist && name)
      out[role].set(r.artist.id, { id: r.artist.id, name });
  }
  return { composers: [...out.composers.values()], lyricists: [...out.lyricists.values()] };
}

/** The names an artist credit lists, each once. */
const creditNames = (credit: MbArtistCredit[]) => [
  ...new Set(credit.map((c) => c.name.trim()).filter(Boolean)),
];

const FEATURING = /\b(?:feat|ft)\b\.?|\bfeaturing\b/i;

/**
 * The names an artist credit lists after "feat.", which credits every name
 * after it as featured.
 */
function creditFeatured(credit: MbArtistCredit[]): string[] {
  const names = creditNames(credit);
  const at = credit.findIndex((c) => FEATURING.test(c.joinphrase));
  if (at === -1) return [];
  const feat = new Set(credit.slice(at + 1).map((c) => c.name.trim()));
  // A name credited both before and after it isn't only featured.
  for (const c of credit.slice(0, at + 1)) feat.delete(c.name.trim());
  return names.filter((n) => feat.has(n));
}

/** A MusicBrainz length in milliseconds as whole seconds. */
const seconds = (ms: number) => Math.round(ms / 1000);

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
  const addCredit = (credit: MbArtistCredit[]) => {
    for (const c of credit) {
      const qid = lookups.artists[c.artist.id];
      if (qid && !(c.name in artists)) artists[c.name] = qid;
    }
  };
  addCredit(release["artist-credit"]);
  // Composers and lyricists, keyed by their names on MusicBrainz, with those not found.
  const unlinkedWriters = new Map<string, string>();
  const addWriters = (ws: MbWriter[]) => {
    for (const w of ws) {
      const qid = lookups.artists[w.id];
      if (qid && !(w.name in artists)) artists[w.name] = qid;
      else if (!qid) unlinkedWriters.set(w.id, w.name);
    }
  };

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
  const several: Record<TrackLinkKey, string[]> = {
    spotify: [],
    appleMusic: [],
    deezer: [],
    tidal: [],
  };
  const taken = new Set(lookups.taken);
  const misplaced = new Map<string, string>();
  const toAdd = {
    recordings: 0,
    works: 0,
    iswcs: 0,
    isrcs: 0,
    spotify: 0,
    appleMusic: 0,
    deezer: 0,
    tidal: 0,
    durationRefs: 0,
  };
  const toExtend = { recordings: 0, works: 0 };
  const discs = media.map((m, i): Disc => {
    const disc = emptyDisc();
    if (media.length > 1) {
      disc.part = parts[i] ?? "";
      if (!disc.part) notes.push(`Disc ${i + 1} has no part. Choose one under Discs.`);
    }
    disc.tracks = m.tracks!.map((t): Track => {
      addCredit(t["artist-credit"]);
      const work = workOf(t);
      const writers = writersOf(t);
      const attributes = attributesOf(t);
      addWriters([...writers.composers, ...writers.lyricists]);
      if (work && lookups.misplacedWorks?.[work] && !misplaced.has(work))
        misplaced.set(work, t.title.trim());
      const iswcs = iswcsOf(t);
      // A composition found by an ISWC is only used when none has the work ID.
      const comp =
        (work && lookups.works[work]) || iswcs.map((v) => lookups.iswcs?.[v]).find(Boolean);
      if (comp) {
        disc.comp[t.position] = comp;
        comps++;
      }
      if (lookups.recordings[t.recording.id]) {
        disc.track[t.position] = lookups.recordings[t.recording.id];
        tracks++;
      }
      const ids: MbRowIds = {
        recording: taken.has(t.recording.id) ? "" : t.recording.id,
        work: work && !taken.has(work) ? work : "",
        recordingName: t.recording.title ?? "",
        workName: theWork(t)?.title ?? "",
        iswcs: iswcs.filter((v) => !taken.has(v)),
        isrcs: [...new Set((t.recording.isrcs ?? []).filter((v) => ISRC_PATTERN.test(v)))],
        spotify: trackLinkOf(t, "spotify").filter((v) => !taken.has(v)),
        appleMusic: trackLinkOf(t, "appleMusic").filter((v) => !taken.has(v)),
        deezer: trackLinkOf(t, "deezer").filter((v) => !taken.has(v)),
        tidal: trackLinkOf(t, "tidal").filter((v) => !taken.has(v)),
        ...writers,
        ...(attributes.length ? { attributes } : {}),
        source: { recording: t.recording.id, ...(work ? { work } : {}), retrieved },
      };
      if (disc.track[t.position]) toExtend.recordings += ids.recording ? 1 : 0;
      if (disc.comp[t.position]) toExtend.works += ids.work ? 1 : 0;
      if (!disc.track[t.position]) {
        toAdd.recordings += ids.recording ? 1 : 0;
        toAdd.isrcs += ids.isrcs.length;
        toAdd.spotify += ids.spotify.length;
        toAdd.appleMusic += ids.appleMusic.length;
        toAdd.deezer += ids.deezer.length;
        toAdd.tidal += ids.tidal.length;
        for (const key of Object.keys(several) as TrackLinkKey[])
          if (trackLinks(t, key).length > 1) several[key].push(t.title.trim());
        toAdd.durationRefs += t.length === null ? 0 : 1;
      }
      if (!disc.comp[t.position]) {
        toAdd.works += ids.work ? 1 : 0;
        toAdd.iswcs += ids.iswcs.length;
      }
      if (t.length === null) missingLength++;
      const feat = creditFeatured(t["artist-credit"]);
      return {
        n: t.position,
        title: t.title.trim(),
        artists: creditNames(t["artist-credit"]),
        ...(feat.length ? { feat } : {}),
        seconds: t.length === null ? null : seconds(t.length),
        mb: ids,
      };
    });
    return disc;
  });
  // A work ID belongs on the composition, never on a single.
  const misplacedItems = [...misplaced].flatMap(([work, title]) =>
    lookups.misplacedWorks![work].map((h) => ({
      qid: h.qid,
      kind: KIND_NOUNS[h.kind],
      title,
      newComp: !lookups.works[work],
    })),
  );
  // One linked under the same name, as a performer say, is linked after all.
  const unlinked = [...new Set(unlinkedWriters.values())].filter((name) => !(name in artists));
  if (unlinked.length)
    notes.push(
      `${plural(unlinked.length, "composer or lyricist has", "composers and lyricists have")} no Wikidata item with their MusicBrainz artist ID: ${joinList(unlinked)}. Link them under People, or the compositions won't name them.`,
    );
  if (missingLength)
    notes.push(
      `${plural(missingLength, "track has", "tracks have")} no length on MusicBrainz, so ${missingLength === 1 ? "it gets" : "they get"} no duration.`,
    );

  const type = PRIMARY_TYPES[rg["primary-type"] ?? ""];
  if (!type)
    notes.push(
      `MusicBrainz lists this as ${rg["primary-type"] ? `a ${rg["primary-type"]}` : "having no type"}, not an album or EP. Check the album's type.`,
    );
  const secondary = rg["secondary-types"] ?? [];
  // "Studio album" is only right for an album, so an EP with no secondary type gets no form.
  const form = secondary.length
    ? (secondary.map((s) => SECONDARY_FORMS[s]).find(Boolean) ?? "")
    : type === EP_CLASS
      ? ""
      : STUDIO_ALBUM;

  const albumQid = lookups.albumQid;
  const ids: AlbumState["ids"] = {
    spotify: "",
    musicbrainz: rg.id,
    appleMusic: "",
    deezer: "",
    tidal: "",
    allmusic: "",
    discogs: "",
  };
  // Each identifier is cited to the release or release group that links it.
  const citedIds: AlbumMb["ids"] = {};
  const severalAlbumLinks: MbReport["severalAlbumLinks"] = [];
  for (const f of ALBUM_ID_FIELDS) {
    if (f.key === "musicbrainz") continue;
    // A Discogs master or AllMusic album is the album as a whole, so MusicBrainz links it
    // from the release group. A Discogs /release/ link on the release is one edition and is skipped.
    const from = f.key === "discogs" || f.key === "allmusic" ? "releaseGroup" : "release";
    const relations = from === "releaseGroup" ? rg.relations : release.relations;
    const linked = [
      ...new Set(
        (relations ?? []).flatMap((r) => f.fromUrl.exec(r.url?.resource ?? "")?.[1] ?? []),
      ),
    ];
    // Several links leave no way to tell which is the album, so none is filled in.
    if (linked.length > 1) {
      if (!albumQid)
        severalAlbumLinks.push({
          from: from === "releaseGroup" ? "release group" : "release",
          n: linked.length,
          what: SEVERAL_ALBUM_LINKS[f.key],
        });
    } else if (linked.length) {
      ids[f.key] = linked[0];
      citedIds[f.key] = { value: linked[0], from };
    }
  }
  const date = rg["first-release-date"] || release.date || "";
  // A date the form can't read gets no publication date, so no reference either.
  const parsedDate = parseDate(date);
  const citesDate = parsedDate.ok && !!parsedDate.val;
  const albumMb: AlbumMb = {
    releaseGroup: rg.id,
    release: release.id,
    releaseGroupName: rg.title ?? "",
    retrieved,
    date: citesDate
      ? { value: date, from: rg["first-release-date"] ? "releaseGroup" : "release" }
      : null,
    ids: citedIds,
  };
  const linkedIds = ALBUM_ID_FIELDS.filter((f) => f.key !== "musicbrainz" && ids[f.key]).map(
    (f) => f.label,
  );
  const language = release["text-representation"]?.language ?? "";
  const p407 = LANGUAGES[language] ?? "";
  if (language && !p407 && language !== "mul")
    notes.push(
      `The release's language (${language}) isn't one the form lists. Set the language of the work in Item settings.`,
    );

  const songs = media.reduce((n, m) => n + m.tracks!.length, 0);
  const report: MbReport = {
    release: release.id,
    misplaced: misplacedItems,
    severalLinks: (Object.entries(several) as [TrackLinkKey, string[]][])
      .filter(([, titles]) => titles.length)
      .map(([key, titles]) => ({ service: TRACK_LINKS[key].service, titles })),
    newTracks: songs - tracks,
    severalAlbumLinks,
    found: {
      album: albumQid ?? null,
      artists: Object.keys(artists).length,
      compositions: comps,
      tracks,
    },
    added: {
      album: albumQid ? [] : linkedIds,
      tracks: idCounts([
        ["recording ID", toAdd.recordings],
        ["ISRC", toAdd.isrcs],
        [TRACK_LINKS.appleMusic.service, toAdd.appleMusic, false],
        [TRACK_LINKS.spotify.service, toAdd.spotify, false],
        [TRACK_LINKS.deezer.service, toAdd.deezer, false],
        [TRACK_LINKS.tidal.service, toAdd.tidal, false],
      ]),
      compositions: idCounts([
        ["work ID", toAdd.works],
        ["ISWC", toAdd.iswcs],
      ]),
    },
    extended: {
      tracks: idCounts([["recording ID", toExtend.recordings]]),
      compositions: idCounts([["work ID", toExtend.works]]),
    },
    references: references({
      ...toAdd,
      // Only a new album gets the date and identifiers.
      date: !albumQid && citesDate,
      albumIds: albumQid ? 0 : linkedIds.length,
    }),
    notes,
  };

  return {
    album: {
      mode: albumQid ? "existing" : "create",
      qid: albumQid ?? "",
      title: release.title,
      artists: creditNames(release["artist-credit"]),
      type: type ?? "Q482994",
      form,
      ids,
      // Only a new album gets references, so an album already on Wikidata keeps
      // none, even if it's switched to a new one, as the summary says.
      mb: albumQid ? null : albumMb,
    },
    artists,
    discs: discs.length ? discs : [emptyDisc()],
    date,
    p407,
    report,
  };
}

/** Which of the new album's, tracks' and compositions' statements get a MusicBrainz reference. */
function references(n: {
  date: boolean;
  albumIds: number;
  isrcs: number;
  iswcs: number;
  spotify: number;
  appleMusic: number;
  deezer: number;
  tidal: number;
  durationRefs: number;
}): string[] {
  return [
    n.date && "publication date",
    n.albumIds && "album IDs",
    n.durationRefs && "durations",
    n.isrcs && "ISRCs",
    n.iswcs && "ISWCs",
    n.spotify + n.appleMusic + n.deezer + n.tidal && "track IDs",
  ].filter(Boolean) as string[];
}

/** The identifiers added at least once, each labelled for its count. A service's name stays as it is. */
const idCounts = (xs: [label: string, n: number, plural?: boolean][]): MbIdCount[] =>
  xs
    .filter(([, n]) => n)
    .map(([label, n, plural = true]) => ({ label: plural && n !== 1 ? `${label}s` : label, n }));

export const joinList = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** How much a report counts, for the start bar. */
export function reportCounts(r: MbReport) {
  const { found, added, extended } = r;
  return {
    found: (found.album ? 1 : 0) + found.artists + found.compositions + found.tracks,
    added: [
      ...added.tracks,
      ...added.compositions,
      ...extended.tracks,
      ...extended.compositions,
    ].reduce((n, c) => n + c.n, added.album.length),
    // Something to fix on Wikidata or check in the form, so the report stays open.
    attention: r.misplaced.length + r.notes.length + r.severalAlbumLinks.length > 0,
  };
}

/** The form filled from `form`, keeping the settings other than the date and language. */
export function applyMbForm(state: State, form: MbForm): State {
  return coerceState({
    start: "mb",
    settings: { ...state.settings, date: form.date, p407: form.p407, p407Custom: false },
    album: form.album,
    artists: form.artists,
    discs: form.discs,
  });
}
