// The Wikidata classes and identifier properties the app cares about, shared by
// the client (plan building), the server (edits, duplicate checks) and the
// weekly dump import (which items to mirror).

/** What kind of music item a mirrored row is. */
export type MusicKind = "artist" | "album" | "ep" | "single" | "work" | "track";

export const MUSIC_KINDS: readonly MusicKind[] = [
  "artist",
  "album",
  "ep",
  "single",
  "work",
  "track",
];

/**
 * `instance of` (P31) classes → kind. Exact QIDs, no subclasses. Earlier
 * entries win when an item has several.
 */
export const CLASS_KINDS: readonly (readonly [string, MusicKind])[] = [
  ["Q482994", "album"],
  ["Q208569", "album"], // studio album (older items use it as P31)
  ["Q209939", "album"], // live album
  ["Q222910", "album"], // compilation album
  ["Q4176708", "album"], // soundtrack album
  ["Q963099", "album"], // remix album
  ["Q169930", "ep"],
  ["Q134556", "single"],
  ["Q55850593", "track"], // music track with vocals
  ["Q55850643", "track"], // music track without lyrics
  ["Q7302866", "track"], // audio track
  ["Q105543609", "work"], // musical work/composition
  ["Q7366", "work"], // song
  ["Q215380", "artist"], // musical group
  ["Q5741069", "artist"], // rock band
  ["Q9212979", "artist"], // musical duo
  ["Q641066", "artist"], // girl group
  ["Q216337", "artist"], // boy band
  ["Q2088357", "artist"], // musical ensemble
];

/** Any item holding one of these is mirrored as an artist (people included). */
export const ARTIST_ID_PROPERTIES = ["P434", "P1902", "P2850", "P1953", "P2722", "P1728"] as const;

/** Every identifier stored in the mirror, for duplicate checks. */
export const ID_PROPERTIES: Readonly<Record<string, string>> = {
  P434: "MusicBrainz artist ID",
  P1902: "Spotify artist ID",
  P2850: "Apple Music artist ID",
  P1953: "Discogs artist ID",
  P2722: "Deezer artist ID",
  P1728: "AllMusic artist ID",
  P436: "MusicBrainz release group ID",
  P5813: "MusicBrainz release ID",
  P2205: "Spotify album ID",
  P2281: "Apple Music album ID",
  P1954: "Discogs master ID",
  P2723: "Deezer album ID",
  P435: "MusicBrainz work ID",
  P4404: "MusicBrainz recording ID",
  P2207: "Spotify track ID",
  P10110: "Apple Music track ID",
  P2724: "Deezer track ID",
};

/**
 * Item-valued properties stored in the mirror (`music_links`), so the app can
 * find existing items for a tracklist: who made them, and how compositions,
 * tracks, singles and albums point at each other.
 */
export const LINK_PROPERTIES: Readonly<Record<string, string>> = {
  P175: "performer",
  P86: "composer",
  P676: "lyricist",
  P2550: "recording or performance of",
  P1433: "published in",
  P361: "part of",
  P658: "tracklist",
};

/** Pick the kind for an item from its P31 values and the properties it has. */
export function kindOf(
  instanceOf: readonly string[],
  properties: Iterable<string>,
): MusicKind | null {
  for (const [qid, kind] of CLASS_KINDS) if (instanceOf.includes(qid)) return kind;
  const props = new Set(properties);
  if (ARTIST_ID_PROPERTIES.some((p) => props.has(p))) return "artist";
  return null;
}

/** The formats of the identifiers a MusicBrainz import adds to new tracks and compositions. */
export const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const SPOTIFY_TRACK_PATTERN = /^[0-9A-Za-z]{22}$/;

/** The album identifiers the album form takes, with how to read a pasted URL. */
export const ALBUM_ID_FIELDS = [
  {
    key: "spotify",
    property: "P2205",
    label: "Spotify album ID",
    pattern: /^[0-9A-Za-z]{22}$/,
    fromUrl: /open\.spotify\.com\/(?:intl-[a-z-]+\/)?album\/([0-9A-Za-z]{22})/,
  },
  {
    key: "musicbrainz",
    property: "P436",
    label: "MusicBrainz release group ID",
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    fromUrl: /musicbrainz\.org\/release-group\/([0-9a-f-]{36})/,
  },
  {
    key: "appleMusic",
    property: "P2281",
    label: "Apple Music album ID",
    pattern: /^\d+$/,
    fromUrl: /music\.apple\.com\/.*\/album\/(?:[^/?#]*\/)?(\d+)/,
  },
  {
    key: "discogs",
    property: "P1954",
    label: "Discogs master ID",
    pattern: /^\d+$/,
    fromUrl: /discogs\.com\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?master\/(\d+)/,
  },
] as const;

export type AlbumIdKey = (typeof ALBUM_ID_FIELDS)[number]["key"];

/** Turn a pasted URL into the bare id; anything else is returned trimmed. */
export function normalizeAlbumId(key: AlbumIdKey, raw: string): string {
  const field = ALBUM_ID_FIELDS.find((f) => f.key === key)!;
  const m = field.fromUrl.exec(raw);
  return m ? m[1] : raw.trim();
}
