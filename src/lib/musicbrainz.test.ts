import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  applyMbForm,
  reportCounts,
  type MbArtistCredit,
  type MbLookups,
  type MbRelease,
  type MbReleaseListing,
  type MbTrack,
  parseMbInput,
  releaseChoices,
  releaseIds,
  releaseToForm,
  wikidataLink,
} from "./musicbrainz.ts";
import { normalizeAlbumId } from "./music.ts";
import { buildPlan } from "./plan.ts";
import { EMPTY } from "./state.ts";
import { EXAMPLE } from "./example.fixture.ts";

// "Day and Night" by Carly Rae Jepsen, trimmed to three tracks a disc.
const RELEASE = JSON.parse(
  readFileSync(new URL("./musicbrainz.fixture.json", import.meta.url), "utf8"),
) as MbRelease;
const release = () => structuredClone(RELEASE);
const NONE: MbLookups = { artists: {}, recordings: {}, works: {}, taken: [] };
const CRJ = "09887aa7-226e-4ecc-9a0c-02d2ae5777e1";
const credit = (...parts: [string, string][]): MbArtistCredit[] =>
  parts.map(([name, joinphrase], i) => ({ name, joinphrase, artist: { id: `a${i}`, name } }));

describe("parseMbInput", () => {
  const id = "6d42c8a3-69c3-458c-9f18-f8a503780607";
  const release = { ok: true, kind: "release", id };
  it("takes a release URL, or a bare ID as a release", () => {
    expect(parseMbInput(`https://musicbrainz.org/release/${id}`)).toEqual(release);
    expect(parseMbInput(` ${id.toUpperCase()} `)).toEqual(release);
    expect(parseMbInput(`https://beta.musicbrainz.org/release/${id}/discids`)).toEqual(release);
    expect(
      parseMbInput("https://beta.musicbrainz.org/release/cb9f38e5-1f35-4411-b41a-d1f7ccf3215d"),
    ).toEqual({ ok: true, kind: "release", id: "cb9f38e5-1f35-4411-b41a-d1f7ccf3215d" });
  });

  it("takes a release group URL", () => {
    expect(parseMbInput(`https://musicbrainz.org/release-group/${id}`)).toEqual({
      ok: true,
      kind: "release-group",
      id,
    });
  });

  it("explains anything else", () => {
    expect(parseMbInput(`https://musicbrainz.org/artist/${id}`)).toEqual({
      ok: false,
      error: "That's a MusicBrainz artist, not a release or release group.",
    });
    expect(parseMbInput("Day and Night")).toMatchObject({ ok: false });
  });
});

describe("releaseChoices", () => {
  const listing = (
    id: string,
    date: string | undefined,
    format: string,
    tracks: number[],
    more: Partial<MbReleaseListing> = {},
  ): MbReleaseListing => ({
    id,
    title: "Day and Night",
    status: "Official",
    date,
    country: "XW",
    disambiguation: "",
    media: tracks.map((n) => ({ format, "track-count": n })),
    ...more,
  });

  it("suggests the earliest official plain edition, digital or CD, with the usual tracks", () => {
    const choices = releaseChoices([
      listing("vinyl", "2026-09-18", '12" Vinyl', [12, 12]),
      listing("withdrawn", "2026-09-01", "Digital Media", [12, 12], { status: "Withdrawn" }),
      listing("atmos", "2026-09-18", "Digital Media", [12, 12], {
        disambiguation: "Dolby Atmos mix",
      }),
      listing("bonus", "2026-09-18", "Digital Media", [12, 13]),
      listing("later", "2026-10-01", "Digital Media", [12, 12]),
      listing("cd", "2026-09-18", "CD", [12, 12], { country: null }),
      listing("digital", "2026-09-18", "Digital Media", [12, 12]),
      listing("undated", undefined, "Digital Media", [12, 12]),
    ]);
    // "later" is the same year, so only its date puts it after "digital".
    expect(choices.map((c) => c.id)).toEqual([
      "digital",
      "later",
      "cd",
      "vinyl",
      "bonus",
      "atmos",
      "undated",
      "withdrawn",
    ]);
    expect(choices[0].label).toBe("2026-09-18 · XW · 2×Digital Media · 24 tracks (12 + 12)");
    expect(choices.at(-1)!.label).toBe(
      "2026-09-01 · XW · 2×Digital Media · 24 tracks (12 + 12) · Withdrawn",
    );
  });

  it("goes by year first, then format, for an album older than CDs", () => {
    const choices = releaseChoices([
      listing("cassette", "1973", "Cassette", [10]),
      listing("cd", "1984", "CD", [10]),
      listing("vinyl", "1973-03-24", '12" Vinyl', [10]),
    ]);
    expect(choices.map((c) => c.id)).toEqual(["vinyl", "cassette", "cd"]);
  });

  it("puts a vague date after an exact one in the same year", () => {
    const choices = releaseChoices([
      listing("year", "1973", '12" Vinyl', [10]),
      listing("exact", "1973-03-24", '12" Vinyl', [10]),
    ]);
    expect(choices.map((c) => c.id)).toEqual(["exact", "year"]);
  });

  it("names a release only when its title is unusual", () => {
    const deluxe = releaseChoices([
      listing("a", "2020", "CD", [10]),
      listing("b", "2020", "CD", [10]),
      listing("c", "2021", "CD", [14], { title: "Day and Night (Deluxe)" }),
    ]).find((c) => c.id === "c")!;
    expect(deluxe.label).toBe("Day and Night (Deluxe) · 2021 · XW · CD · 14 tracks");
  });
});

describe("wikidataLink", () => {
  it("reads the release group's Wikidata link", () => {
    expect(wikidataLink(RELEASE["release-group"].relations)).toBe("Q140316456");
    expect(wikidataLink([])).toBeUndefined();
  });
});

describe("releaseIds", () => {
  it("collects the IDs to look up, once each", () => {
    const ids = releaseIds(RELEASE);
    expect(ids.releaseGroup).toBe("b012a117-afa3-4ea3-879f-eeb61b974b0a");
    expect(ids.artists).toEqual([CRJ]);
    expect(ids.recordings).toHaveLength(6);
    expect(ids.works).toHaveLength(6);
    expect(ids.spotifyTracks).toEqual(["6HSinPEEP7FeS2k1y7BD7j"]);
  });
});

describe("releaseToForm", () => {
  it("fills the album, discs and date for a new album", () => {
    const form = releaseToForm(RELEASE, NONE, "2026-10-04");
    expect(form.album).toEqual({
      mode: "create",
      qid: "",
      title: "Day and Night",
      artists: ["Carly Rae Jepsen"],
      type: "Q482994",
      form: "Q208569",
      ids: {
        spotify: "",
        musicbrainz: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
        appleMusic: "",
        deezer: "1076048342",
        tidal: "",
        allmusic: "",
        discogs: "4348311",
      },
      release: RELEASE.id,
      mb: {
        releaseGroup: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
        release: RELEASE.id,
        releaseGroupName: "Day and Night",
        retrieved: "2026-10-04",
        date: { value: "2026-09-18", from: "releaseGroup" },
        ids: {
          deezer: { value: "1076048342", from: "release" },
          discogs: { value: "4348311", from: "releaseGroup" },
        },
      },
    });
    expect(form.date).toBe("2026-09-18");
    expect(form.p407).toBe("Q1860");
    expect(form.discs.map((d) => d.part)).toEqual(["Q61629664", "Q61629680"]);
    expect(form.discs[0].tracks.map((t) => ({ ...t, mb: undefined }))).toEqual([
      { n: 1, title: "After All", artists: ["Carly Rae Jepsen"], seconds: 252 },
      { n: 2, title: "Habits of Creatures", artists: ["Carly Rae Jepsen"], seconds: 177 },
      { n: 3, title: "Versailles", artists: ["Carly Rae Jepsen"], seconds: 194 },
    ]);
    expect(form.report).toEqual({
      release: RELEASE.id,
      misplaced: [],
      severalLinks: [],
      newTracks: 6,
      severalAlbumLinks: [],
      found: { album: null, artists: 0, compositions: 0, tracks: 0 },
      added: {
        album: ["Deezer album ID", "Discogs master ID"],
        tracks: [
          { label: "recording IDs", n: 6 },
          { label: "ISRCs", n: 6 },
          { label: "Spotify", n: 1 },
        ],
        compositions: [{ label: "work IDs", n: 6 }],
      },
      extended: { tracks: [], compositions: [] },
      references: ["publication date", "album IDs", "durations", "ISRCs", "track IDs"],
      notes: [],
    });
  });

  it("keeps each track's identifiers on it", () => {
    const [first] = releaseToForm(RELEASE, NONE, "2026-10-04").discs;
    expect(first.tracks[0].mb!).toEqual({
      recording: "263340e1-2f03-4b31-b404-a06a8acda193",
      work: "2bf1a377-686f-426a-ab5a-309466d201e9",
      recordingName: "After All",
      workName: "After All",
      iswcs: [],
      isrcs: ["USUM72604366"],
      spotify: ["6HSinPEEP7FeS2k1y7BD7j"],
      appleMusic: [],
      deezer: [],
      tidal: [],
      composers: [],
      lyricists: [],
      source: {
        recording: "263340e1-2f03-4b31-b404-a06a8acda193",
        work: "2bf1a377-686f-426a-ab5a-309466d201e9",
        retrieved: "2026-10-04",
      },
    });
    expect(first.tracks.every((t) => t.mb)).toBe(true);
  });

  it("keeps what the performance relation says about the recording", () => {
    const r = release();
    r.media[0].tracks![0].recording.relations!.find((x) => x.work)!.attributes = [
      "instrumental",
      "live",
      "karaoke",
    ];
    const [first, second] = releaseToForm(r, NONE).discs[0].tracks;
    expect(first.mb?.attributes).toEqual(["live", "instrumental"]);
    expect(second.mb).not.toHaveProperty("attributes");
  });

  it("keeps only what every performance of a medley says", () => {
    const r = release();
    const rels = r.media[0].tracks![0].recording.relations!;
    const perf = rels.find((x) => x.work)!;
    perf.attributes = ["instrumental", "medley"];
    rels.push({
      ...perf,
      work: { id: "2bf1a377-686f-426a-ab5a-309466d201e9", title: "Another" },
      attributes: ["medley"],
    });
    expect(releaseToForm(r, NONE).discs[0].tracks[0].mb?.attributes).toEqual(["medley"]);
  });

  it("keeps the work's languages when the form lists them all", () => {
    const r = release();
    const work = (i: number) =>
      r.media[0].tracks![i].recording.relations!.find((x) => x.work)!.work!;
    work(0).languages = ["spa", "eng"];
    work(1).languages = ["zxx"];
    work(2).languages = ["eng", "fin"];
    const [a, b, c] = releaseToForm(r, NONE).discs[0].tracks;
    expect(a.mb?.languages).toEqual(["Q1321", "Q1860"]);
    expect(b.mb?.languages).toEqual(["Q22282939"]);
    expect(c.mb).not.toHaveProperty("languages");
    work(0).languages = ["zxx", "eng"];
    expect(releaseToForm(r, NONE).discs[0].tracks[0].mb?.languages).toEqual(["Q1860"]);
  });

  it("keeps when the recording was made, with an end only when it differs", () => {
    const r = release();
    const rel = (i: number) => r.media[0].tracks![i].recording.relations!.find((x) => x.work)!;
    Object.assign(rel(0), { begin: "2025-11-03", end: "2025-11-05" });
    Object.assign(rel(1), { begin: "2025-11", end: "2025-11" });
    Object.assign(rel(2), { begin: "Nov 2025", end: null });
    const form = releaseToForm(r, NONE);
    const [a, b, c] = form.discs[0].tracks;
    expect(a.mb?.recorded).toEqual({ begin: "2025-11-03", end: "2025-11-05" });
    expect(b.mb?.recorded).toEqual({ begin: "2025-11", end: "" });
    expect(c.mb).not.toHaveProperty("recorded");
    expect(form.report.references).toContain("recording dates");
  });

  it("dates a medley from the first to the last day of its works' recordings", () => {
    const r = release();
    const rels = r.media[0].tracks![0].recording.relations!;
    const perf = rels.find((x) => x.work)!;
    Object.assign(perf, { begin: "2025-11-10", end: "2025-11-12" });
    rels.push({
      ...perf,
      work: { id: "2bf1a377-686f-426a-ab5a-309466d201e9", title: "Another" },
      begin: "2025-11-03",
      end: null,
    });
    expect(releaseToForm(r, NONE).discs[0].tracks[0].mb?.recorded).toEqual({
      begin: "2025-11-03",
      end: "2025-11-12",
    });
  });

  describe("composers and lyricists", () => {
    const BERGER = "ffadf26a-2593-4eaf-8c5d-a54cbc5aedc5";
    const KAPARI = "0d32b53d-6d72-4eea-9009-eca2cf7c11a8";
    const NOONIE = "e292bc5a-ee7f-4160-97d5-d175983421ab";
    const rel = (type: string, id: string, name: string, disambiguation = "") => ({
      type,
      "target-type": "artist",
      artist: { id, name, disambiguation },
    });
    const withWriters = () => {
      const r = release();
      r.media[0].tracks![0].recording.relations!.find((x) => x.work)!.work!.relations = [
        rel("composer", CRJ, "Carly Rae Jepsen"),
        rel("lyricist", CRJ, "Carly Rae Jepsen"),
        rel("composer", BERGER, "Patrik Berger"),
        rel("composer", BERGER, "Patrik Berger"),
        rel("writer", KAPARI, "KAPARI"),
        rel("arranger", NOONIE, "Noonie Bao"),
      ];
      return r;
    };

    it("are read from the work, leaving out writers, arrangers and the like", () => {
      const [track] = releaseToForm(withWriters(), NONE).discs[0].tracks;
      expect(track.mb).toMatchObject({
        composers: [
          { id: CRJ, name: "Carly Rae Jepsen" },
          { id: BERGER, name: "Patrik Berger" },
        ],
        lyricists: [{ id: CRJ, name: "Carly Rae Jepsen" }],
      });
      expect(releaseIds(withWriters()).artists).toEqual(expect.arrayContaining([CRJ, BERGER]));
    });

    it("are linked by their MusicBrainz artist ID, and the rest listed in a note", () => {
      const form = releaseToForm(withWriters(), { ...NONE, artists: { [CRJ]: "Q52583" } });
      expect(form.artists).toEqual({ "Carly Rae Jepsen": "Q52583" });
      expect(form.report.notes).toContain(
        "1 composer or lyricist has no Wikidata item with their MusicBrainz artist ID: Patrik Berger. Link them under People, or the compositions won't name them.",
      );
      const linked = releaseToForm(withWriters(), {
        ...NONE,
        artists: { [CRJ]: "Q52583", [BERGER]: "Q7146018" },
      });
      expect(linked.artists).toEqual({ "Carly Rae Jepsen": "Q52583", "Patrik Berger": "Q7146018" });
      expect(linked.report.notes.join(" ")).not.toContain("composer");
    });

    describe("who share a name with another artist", () => {
      const OTHER = "8b8a38a9-a290-4560-84f6-3d4466e8d791";
      const sharing = (disambiguation?: string) => {
        const r = withWriters();
        r.media[0].tracks![0].recording.relations!.find((x) => x.work)!.work!.relations = [
          rel("composer", OTHER, "Carly Rae Jepsen", disambiguation),
        ];
        return r;
      };

      it("are listed under their disambiguation, and don't get the other's QID", () => {
        const form = releaseToForm(sharing("composer"), { ...NONE, artists: { [CRJ]: "Q52583" } });
        expect(form.discs[0].tracks[0].mb?.composers).toEqual([
          { id: OTHER, name: "Carly Rae Jepsen (composer)" },
        ]);
        expect(form.artists).toEqual({ "Carly Rae Jepsen": "Q52583" });
        expect(form.report.notes.join(" ")).toContain(
          "no Wikidata item with their MusicBrainz artist ID: Carly Rae Jepsen (composer)",
        );
      });

      it("are numbered when theirs is empty", () => {
        const form = releaseToForm(sharing(), {
          ...NONE,
          artists: { [CRJ]: "Q52583", [OTHER]: "Q1" },
        });
        expect(form.discs[0].tracks[0].mb?.composers).toEqual([
          { id: OTHER, name: "Carly Rae Jepsen (2)" },
        ]);
        expect(form.artists).toEqual({
          "Carly Rae Jepsen": "Q52583",
          "Carly Rae Jepsen (2)": "Q1",
        });
      });
    });
  });

  it("keeps the recording's and work's own names, not the track's title", () => {
    const renamed = release();
    const t = renamed.media[0].tracks![0];
    t.title = "After All (Remix)";
    t.recording.title = "After All (remix)";
    t.recording.relations!.find((r) => r.work)!.work!.title = "After All’s Work";
    expect(releaseToForm(renamed, NONE).discs[0].tracks[0]).toMatchObject({
      title: "After All (Remix)",
      mb: { recordingName: "After All (remix)", workName: "After All’s Work" },
    });
  });

  it("keeps the source even when an item already has the recording ID", () => {
    const t = RELEASE.media[0].tracks![0];
    const form = releaseToForm(RELEASE, { ...NONE, taken: [t.recording.id] });
    expect(form.discs[0].tracks[0].mb!.source?.recording).toBe(t.recording.id);
    const noLength = structuredClone(RELEASE);
    noLength.media[0].tracks![0].length = null;
    const [track] = releaseToForm(noLength, NONE).discs[0].tracks;
    expect(track.seconds).toBeNull();
    expect(track.mb!.source?.recording).toBe(t.recording.id);
  });

  it("leaves out identifiers an item already has", () => {
    const t = RELEASE.media[0].tracks![0];
    const work = t.recording.relations!.find((r) => r.work)!.work!.id;
    const form = releaseToForm(RELEASE, {
      ...NONE,
      taken: [t.recording.id, work, "6HSinPEEP7FeS2k1y7BD7j"],
    });
    expect(form.discs[0].tracks[0].mb!).toMatchObject({
      recording: "",
      work: "",
      iswcs: [],
      isrcs: ["USUM72604366"],
      spotify: [],
    });
  });

  it("adds no Spotify track ID when a recording links more than one", () => {
    const many = release();
    const rels = many.media[0].tracks![0].recording.relations!;
    const spotify = rels.find((r) => r.url?.resource.includes("open.spotify.com"))!;
    rels.push(structuredClone(spotify), {
      ...structuredClone(spotify),
      url: { resource: "https://open.spotify.com/track/1strUR6J5Ozg7T5k84gn5w" },
    });
    expect(releaseIds(many).spotifyTracks).toEqual([]);
    const form = releaseToForm(many, NONE);
    expect(form.discs[0].tracks[0].mb!.spotify).toEqual([]);
    expect(form.report.notes).toEqual([]);
    expect(form.report.severalLinks).toEqual([
      { service: "Spotify", titles: [RELEASE.media[0].tracks![0].title] },
    ]);
    expect(form.report.added.tracks).toEqual([
      { label: "recording IDs", n: 6 },
      { label: "ISRCs", n: 6 },
    ]);
  });

  describe("Apple Music track IDs", () => {
    const apple = (id: string, type = "streaming") => ({
      type,
      "target-type": "url",
      url: { resource: `https://music.apple.com/gb/song/${id}` },
    });
    const withApple = (...ids: ReturnType<typeof apple>[]) => {
      const r = release();
      r.media[0].tracks![0].recording.relations!.push(...ids);
      return r;
    };

    it("adds the one a recording links, once", () => {
      const r = withApple(apple("1065973702"), apple("1065973702", "purchase for download"));
      expect(releaseIds(r).appleMusicTracks).toEqual(["1065973702"]);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.appleMusic).toEqual(["1065973702"]);
      expect(form.discs[0].tracks[1].mb!.appleMusic).toEqual([]);
      expect(form.report.notes).toEqual([]);
      expect(form.report.added.tracks).toEqual([
        { label: "recording IDs", n: 6 },
        { label: "ISRCs", n: 6 },
        { label: "Apple Music", n: 1 },
        { label: "Spotify", n: 1 },
      ]);
    });

    it("adds none when a recording links more than one", () => {
      const r = withApple(apple("1065973702"), apple("1665303757"));
      expect(releaseIds(r).appleMusicTracks).toEqual([]);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.appleMusic).toEqual([]);
      expect(form.report.severalLinks).toEqual([
        { service: "Apple Music", titles: [RELEASE.media[0].tracks![0].title] },
      ]);
    });

    it("leaves out one an item already has", () => {
      const form = releaseToForm(withApple(apple("1065973702")), {
        ...NONE,
        taken: ["1065973702"],
      });
      expect(form.discs[0].tracks[0].mb!.appleMusic).toEqual([]);
    });

    it("ignores other Apple links", () => {
      const video = {
        ...apple(""),
        url: { resource: "https://music.apple.com/gb/music-video/1065973702" },
      };
      expect(releaseIds(withApple(video)).appleMusicTracks).toEqual([]);
    });
  });

  describe("ISWCs", () => {
    const withIswcs = (...iswcs: string[]) => {
      const r = release();
      r.media[0].tracks![0].recording.relations!.find((x) => x.work)!.work!.iswcs = iswcs;
      return r;
    };
    const work = RELEASE.media[0].tracks![0].recording.relations!.find((x) => x.work)!.work!.id;

    it("adds the one the composition has, and counts it in the report", () => {
      const r = withIswcs("T-345.246.800-1", "not an ISWC");
      expect(releaseIds(r).iswcs).toEqual(["T-345.246.800-1"]);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.iswcs).toEqual(["T-345.246.800-1"]);
      expect(form.discs[0].tracks[1].mb!.iswcs).toEqual([]);
      expect(form.report.notes).toEqual([]);
      expect(form.report.added.compositions).toEqual([
        { label: "work IDs", n: 6 },
        { label: "ISWC", n: 1 },
      ]);
      expect(form.report.references).toEqual(expect.arrayContaining(["ISRCs", "ISWCs"]));
    });

    it("adds all of them when the composition has more than one", () => {
      const r = withIswcs("T-345.246.800-1", "T-345.246.801-2", "T-345.246.800-1");
      expect(releaseIds(r).iswcs).toEqual(["T-345.246.800-1", "T-345.246.801-2"]);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.iswcs).toEqual(["T-345.246.800-1", "T-345.246.801-2"]);
      expect(form.report.notes).toEqual([]);
      expect(form.report.added.compositions).toContainEqual({ label: "ISWCs", n: 2 });
    });

    it("leaves out one an item already has", () => {
      const form = releaseToForm(withIswcs("T-345.246.800-1", "T-345.246.801-2"), {
        ...NONE,
        taken: ["T-345.246.800-1"],
      });
      expect(form.discs[0].tracks[0].mb!.iswcs).toEqual(["T-345.246.801-2"]);
    });

    it("finds the composition by it when none has the work ID", () => {
      const r = withIswcs("T-345.246.800-1");
      const byIswc = { ...NONE, iswcs: { "T-345.246.800-1": "Q30" } };
      expect(releaseToForm(r, byIswc).discs[0].comp).toEqual({ "1": "Q30" });
      const both = { ...byIswc, works: { [work]: "Q20" } };
      expect(releaseToForm(r, both).discs[0].comp).toEqual({ "1": "Q20" });
    });

    it("counts the work ID the composition found by it gets", () => {
      const r = withIswcs("T-345.246.800-1");
      const form = releaseToForm(r, { ...NONE, iswcs: { "T-345.246.800-1": "Q30" } });
      expect(form.discs[0].tracks[0].mb!.work).toBe(work);
      expect(form.report.extended).toEqual({
        tracks: [],
        compositions: [{ label: "work ID", n: 1 }],
      });
      expect(form.report.added.compositions).toContainEqual({ label: "work IDs", n: 5 });
    });

    it("finds the composition by any of its ISWCs", () => {
      const r = withIswcs("T-345.246.800-1", "T-345.246.801-2");
      const byIswc = { ...NONE, iswcs: { "T-345.246.801-2": "Q30" } };
      expect(releaseToForm(r, byIswc).discs[0].comp).toEqual({ "1": "Q30" });
    });
  });

  describe("identifiers on more than one recording or work", () => {
    const [first, second] = RELEASE.media[0].tracks!;
    const workRel = (t: MbTrack) => t.recording.relations!.find((x) => x.work)!;

    it("go on neither track, with a note", () => {
      const r = release();
      r.media[0].tracks![1].recording.isrcs = ["USUM72604366"];
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.isrcs).toEqual([]);
      expect(form.discs[0].tracks[1].mb!.isrcs).toEqual([]);
      expect(form.report.notes).toContain(
        `1 identifier is on more than one recording or work on MusicBrainz, so no new item gets it: ISRC USUM72604366 (1.${first.position} “${first.title}” and 1.${second.position} “${second.title}”).`,
      );
      expect(form.report.added.tracks).toContainEqual({ label: "ISRCs", n: 4 });
    });

    it("name each track by its row when they share a title", () => {
      const r = release();
      r.media[0].tracks![1].title = first.title;
      r.media[0].tracks![1].recording.isrcs = ["USUM72604366"];
      const form = releaseToForm(r, NONE);
      expect(form.report.notes.join(" ")).toContain(
        `(1.${first.position} “${first.title}” and 1.${second.position} “${first.title}”)`,
      );
    });

    it("go on neither composition when two works have the same ISWC", () => {
      const r = release();
      for (const t of r.media[0].tracks!.slice(0, 2)) workRel(t).work!.iswcs = ["T-345.246.800-1"];
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.iswcs).toEqual([]);
      expect(form.discs[0].tracks[1].mb!.iswcs).toEqual([]);
      expect(form.report.notes.join(" ")).toContain("ISWC T-345.246.800-1");
    });

    it("stay on a recording that's on the release twice", () => {
      const r = release();
      r.media[0].tracks![1].recording = structuredClone(r.media[0].tracks![0].recording);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[1].mb!.isrcs).toEqual(["USUM72604366"]);
      expect(form.discs[0].tracks[1].mb!.spotify).toEqual(["6HSinPEEP7FeS2k1y7BD7j"]);
      expect(form.report.notes.join(" ")).not.toContain("more than one recording");
    });
  });

  describe("Deezer track IDs", () => {
    const deezer = (url: string) => ({
      type: "free streaming",
      "target-type": "url",
      url: { resource: url },
    });
    const withDeezer = (...links: ReturnType<typeof deezer>[]) => {
      const r = release();
      r.media[0].tracks![0].recording.relations!.push(...links);
      return r;
    };

    it("adds the one a recording links", () => {
      const r = withDeezer(deezer("https://www.deezer.com/track/69018826"));
      expect(releaseIds(r).deezerTracks).toEqual(["69018826"]);
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.deezer).toEqual(["69018826"]);
      expect(form.discs[0].tracks[1].mb!.deezer).toEqual([]);
      expect(form.report.added.tracks).toContainEqual({ label: "Deezer", n: 1 });
    });

    it("reads a link with a language in it", () => {
      const r = withDeezer(deezer("https://www.deezer.com/fr/track/69018826"));
      expect(releaseIds(r).deezerTracks).toEqual(["69018826"]);
    });

    it("adds none when a recording links more than one", () => {
      const r = withDeezer(
        deezer("https://www.deezer.com/track/69018826"),
        deezer("https://www.deezer.com/track/69018827"),
      );
      const form = releaseToForm(r, NONE);
      expect(form.discs[0].tracks[0].mb!.deezer).toEqual([]);
      expect(form.report.severalLinks).toEqual([
        { service: "Deezer", titles: [RELEASE.media[0].tracks![0].title] },
      ]);
    });

    it("leaves out one an item already has", () => {
      const r = withDeezer(deezer("https://www.deezer.com/track/69018826"));
      const form = releaseToForm(r, { ...NONE, taken: ["69018826"] });
      expect(form.discs[0].tracks[0].mb!.deezer).toEqual([]);
    });

    it("ignores other Deezer links", () => {
      const r = withDeezer(deezer("https://www.deezer.com/album/10535858"));
      expect(releaseIds(r).deezerTracks).toEqual([]);
    });
  });

  it("doesn't count identifiers for rows that reuse an existing track", () => {
    const rec = RELEASE.media[0].tracks![0].recording.id;
    const form = releaseToForm(RELEASE, { ...NONE, recordings: { [rec]: "Q10" }, taken: [rec] });
    expect(form.report.added.tracks).toEqual([
      { label: "recording IDs", n: 5 },
      { label: "ISRCs", n: 5 },
    ]);
  });

  it("fills in what the mirror already has", () => {
    const rec = RELEASE.media[0].tracks![1].recording.id;
    const work = RELEASE.media[1].tracks![0].recording.relations![0].work!.id;
    const form = releaseToForm(RELEASE, {
      albumQid: "Q140316456",
      artists: { [CRJ]: "Q52583" },
      recordings: { [rec]: "Q10" },
      works: { [work]: "Q20" },
      // Items found by an ID have it.
      taken: [rec, work],
    });
    expect(form.album).toMatchObject({
      mode: "existing",
      qid: "Q140316456",
      // Kept for the link to it, though an existing album gets no references.
      release: RELEASE.id,
      mb: null,
    });
    expect(form.artists).toEqual({ "Carly Rae Jepsen": "Q52583" });
    expect(form.discs[0].track).toEqual({ "2": "Q10" });
    expect(form.discs[1].comp).toEqual({ "1": "Q20" });
    expect(form.report.found).toEqual({
      album: "Q140316456",
      artists: 1,
      compositions: 1,
      tracks: 1,
    });
    expect(form.report.added.album).toEqual([]);
    expect(reportCounts(form.report)).toEqual({ found: 4, added: 16, attention: false });
  });

  describe("a work ID on an item that isn't a composition", () => {
    const t = RELEASE.media[0].tracks![0];
    const work = t.recording.relations!.find((r) => r.work)!.work!.id;

    it("adds it to the new composition, and says to remove it from the single", () => {
      const form = releaseToForm(RELEASE, {
        ...NONE,
        misplacedWorks: { [work]: [{ qid: "Q2081516", kind: "single" }] },
      });
      expect(form.discs[0].comp).toEqual({});
      expect(form.discs[0].tracks[0].mb!.work).toBe(work);
      expect(form.report.misplaced).toEqual([
        { qid: "Q2081516", kind: "single", title: t.title, newComp: true },
      ]);
    });

    it("names every item that has it, and still reuses a composition that has it", () => {
      const form = releaseToForm(RELEASE, {
        ...NONE,
        works: { [work]: "Q20" },
        taken: [work],
        misplacedWorks: {
          [work]: [
            { qid: "Q1", kind: "single" },
            { qid: "Q2", kind: "ep" },
          ],
        },
      });
      expect(form.discs[0].comp).toEqual({ "1": "Q20" });
      expect(form.discs[0].tracks[0].mb!.work).toBe("");
      expect(form.report.misplaced).toEqual([
        { qid: "Q1", kind: "single", title: t.title, newComp: false },
        { qid: "Q2", kind: "EP", title: t.title, newComp: false },
      ]);
    });
  });

  it("reads the type, form and streaming IDs", () => {
    const r = release();
    r["release-group"]["primary-type"] = "EP";
    r["release-group"]["secondary-types"] = ["Live"];
    r.relations = [
      {
        type: "free streaming",
        "target-type": "url",
        url: { resource: "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy" },
      },
      {
        type: "streaming",
        "target-type": "url",
        url: { resource: "https://music.apple.com/gb/album/day-and-night/1820000000" },
      },
      {
        type: "free streaming",
        "target-type": "url",
        url: { resource: "https://www.deezer.com/album/790000000" },
      },
      {
        type: "streaming",
        "target-type": "url",
        url: { resource: "https://tidal.com/album/450000000" },
      },
    ];
    const { album } = releaseToForm(r, NONE);
    expect(album).toMatchObject({ type: "Q169930", form: "Q209939" });
    expect(album.ids).toMatchObject({
      spotify: "4aawyAB9vmqN3uQ7FjRGTy",
      appleMusic: "1820000000",
      deezer: "790000000",
      tidal: "450000000",
    });
    // Linked from the release, so they're cited to it.
    expect(album.mb?.ids).toMatchObject({
      spotify: { value: "4aawyAB9vmqN3uQ7FjRGTy", from: "release" },
      appleMusic: { value: "1820000000", from: "release" },
      deezer: { value: "790000000", from: "release" },
      tidal: { value: "450000000", from: "release" },
    });
  });

  it("reads the AllMusic album from the release group, not the release", () => {
    const allmusic = (id: string) => ({
      type: "allmusic",
      "target-type": "url",
      url: { resource: `https://www.allmusic.com/album/${id}` },
    });
    const r = release();
    r.relations = [allmusic("mw0000000001")];
    expect(releaseToForm(r, NONE).album.ids.allmusic).toBe("");
    r["release-group"].relations = [allmusic("mw0004834138")];
    const { album } = releaseToForm(r, NONE);
    expect(album.ids.allmusic).toBe("mw0004834138");
    expect(album.mb?.ids.allmusic).toEqual({ value: "mw0004834138", from: "releaseGroup" });
  });

  it("reads a recording's Tidal track ID", () => {
    const r = release();
    r.media[0].tracks![0].recording.relations!.push({
      type: "streaming",
      "target-type": "url",
      url: { resource: "https://tidal.com/track/454960380" },
    });
    expect(releaseIds(r).tidalTracks).toEqual(["454960380"]);
    const form = releaseToForm(r, NONE);
    expect(form.discs[0].tracks[0].mb!.tidal).toEqual(["454960380"]);
    expect(form.report.added.tracks).toContainEqual({ label: "Tidal", n: 1 });
  });

  it("gives an EP with no secondary type no form, not studio album", () => {
    const r = release();
    r["release-group"]["primary-type"] = "EP";
    r["release-group"]["secondary-types"] = [];
    const { album } = releaseToForm(r, NONE);
    expect(album).toMatchObject({ type: "Q169930", form: "" });
  });

  it("cites the release's own date when the release group has none", () => {
    const r = release();
    delete r["release-group"]["first-release-date"];
    r.date = "2026-09-19";
    const form = releaseToForm(r, NONE);
    expect(form.date).toBe("2026-09-19");
    expect(form.album.mb?.date).toEqual({ value: "2026-09-19", from: "release" });
    delete r.date;
    expect(releaseToForm(r, NONE).album.mb?.date).toBeNull();
  });

  it("doesn't promise a reference on a date the form can't read", () => {
    const r = release();
    r["release-group"]["first-release-date"] = "2026-02-30";
    const form = releaseToForm(r, NONE);
    expect(form.album.mb?.date).toBeNull();
    expect(form.report.references).toEqual(["album IDs", "durations", "ISRCs", "track IDs"]);
  });

  it("doesn't mention album references for an album already on Wikidata", () => {
    const form = releaseToForm(RELEASE, { ...NONE, albumQid: "Q140316456" });
    expect(form.report.references).toEqual(["durations", "ISRCs", "track IDs"]);
    // So switching to a new album can't add the references the report left out.
    expect(form.album.mb).toBeNull();
    // The report still has the release, for the start bar's link to it.
    expect(form.report.release).toBe(RELEASE.id);
  });

  it("reads the Discogs master ID from the release group, not the release", () => {
    const r = release();
    r["release-group"].relations = [];
    r.relations = [
      {
        type: "discogs",
        "target-type": "url",
        url: { resource: "https://www.discogs.com/release/12345678" },
      },
      {
        type: "discogs",
        "target-type": "url",
        url: { resource: "https://www.discogs.com/master/4348311" },
      },
    ];
    const form = releaseToForm(r, NONE);
    expect(form.album.ids.discogs).toBe("");
    expect(form.report.added.album).not.toContain("Discogs master ID");
    expect(form.report.severalAlbumLinks).toEqual([]);
  });

  it("fills in no Discogs master when the release group links several", () => {
    const r = release();
    const masters = ["4348311", "4348312"].map((id) => ({
      type: "discogs",
      "target-type": "url",
      url: { resource: `https://www.discogs.com/master/${id}` },
    }));
    r["release-group"].relations = masters;
    const form = releaseToForm(r, NONE);
    expect(form.album.ids.discogs).toBe("");
    expect(form.report.severalAlbumLinks).toEqual([
      { from: "release group", n: 2, what: "Discogs masters" },
    ]);
    // An existing album gets no IDs, so there's nothing to note.
    expect(releaseToForm(r, { ...NONE, albumQid: "Q140316456" }).report.severalAlbumLinks).toEqual(
      [],
    );
  });

  it("fills in no Spotify album when the release links several", () => {
    const r = release();
    r.relations = ["4aawyAB9vmqN3uQ7FjRGTy", "4aawyAB9vmqN3uQ7FjRGTz"].map((id) => ({
      type: "free streaming",
      "target-type": "url",
      url: { resource: `https://open.spotify.com/album/${id}` },
    }));
    const form = releaseToForm(r, NONE);
    expect(form.album.ids.spotify).toBe("");
    expect(form.album.mb?.ids.spotify).toBeUndefined();
    expect(form.report.severalAlbumLinks).toEqual([
      { from: "release", n: 2, what: "Spotify albums" },
    ]);
  });

  it("notes what it can't fill in", () => {
    const r = release();
    r["release-group"]["primary-type"] = "Single";
    r["release-group"]["secondary-types"] = ["Mixtape/Street"];
    r["text-representation"] = { language: "fin" };
    r.media[0].tracks![0].length = null;
    r.media[1].tracks![0]["artist-credit"] = credit(["Simon & Garfunkel", ""]);
    const form = releaseToForm(r, NONE);
    expect(form.album.form).toBe("");
    expect(form.p407).toBe("");
    expect(form.discs[0].tracks[0].seconds).toBeNull();
    expect(form.report.notes).toEqual([
      "1 track has no length on MusicBrainz, so it gets no duration.",
      expect.stringContaining("a Single, not an album or EP"),
      expect.stringContaining("language (fin)"),
    ]);
  });

  it("keeps who a track credits as featured", () => {
    const r = release();
    r.media[0].tracks![0]["artist-credit"] = credit(
      ["Carly Rae Jepsen", " feat. "],
      ["A", " & "],
      ["B", ""],
    );
    r.media[0].tracks![1]["artist-credit"] = credit(["Carly Rae Jepsen", " & "], ["A", ""]);
    const [first, second] = releaseToForm(r, NONE).discs[0].tracks;
    expect(first).toMatchObject({ artists: ["Carly Rae Jepsen", "A", "B"], feat: ["A", "B"] });
    expect(second).not.toHaveProperty("feat");
  });

  it("keeps each credited name whole", () => {
    const r = release();
    r["artist-credit"] = credit(["Simon & Garfunkel", " feat. "], ["Carly Rae Jepsen", ""]);
    r.media[1].tracks![0]["artist-credit"] = credit(["Simon & Garfunkel", ""]);
    const form = releaseToForm(r, NONE);
    expect(form.discs[1].tracks[0].artists).toEqual(["Simon & Garfunkel"]);
    expect(form.album.artists).toEqual(["Simon & Garfunkel", "Carly Rae Jepsen"]);
    expect(form.report.notes).toEqual([]);
  });

  it("uses vinyl parts for vinyl, and none for one disc", () => {
    const r = release();
    for (const m of r.media) m.format = '12" Vinyl';
    expect(releaseToForm(r, NONE).discs.map((d) => d.part)).toEqual(["Q109658523", "Q109658526"]);
    r.media = r.media.slice(0, 1);
    expect(releaseToForm(r, NONE).discs.map((d) => d.part)).toEqual([""]);
  });

  it("leaves out media without tracks", () => {
    const r = release();
    r.media.push({ position: 3, format: "DVD-Video", tracks: [] });
    const form = releaseToForm(r, NONE);
    expect(form.discs).toHaveLength(2);
    expect(form.report.notes[0]).toBe("1 medium has no tracks on MusicBrainz and was left out.");
  });

  it("gives each disc the part of its place on the release, after a medium left out", () => {
    const r = release();
    r.media[0].tracks = [];
    expect(releaseToForm(r, NONE).discs.map((d) => d.part)).toEqual(["Q61629680"]);
    r.media = [release().media[0], { position: 2, format: "CD", tracks: [] }, release().media[1]];
    r.media[2].position = 3;
    expect(releaseToForm(r, NONE).discs.map((d) => d.part)).toEqual(["Q61629664", "Q61747994"]);
  });
});

describe("applyMbForm", () => {
  it("replaces the form but keeps the other settings", () => {
    const state = {
      ...structuredClone(EXAMPLE),
      settings: { ...EXAMPLE.settings, lang: "fr", recDate: "2019" },
    };
    const next = applyMbForm(state, releaseToForm(RELEASE, NONE));
    expect(next.settings).toMatchObject({
      lang: "fr",
      date: "2026-09-18",
      p407: "Q1860",
      recDate: "",
    });
    expect(next.album.mode).toBe("create");
    expect(next.start).toBe("mb");
    expect(next.discs).toHaveLength(2);
    expect(next.discs[0].comp).toEqual({});
  });

  it("makes an instrumental release's tracks without lyrics, and another's not", () => {
    const wordless = release();
    wordless["text-representation"] = { language: "zxx" };
    const next = applyMbForm(EXAMPLE, releaseToForm(wordless, NONE));
    expect(next.settings).toMatchObject({ p407: "Q22282939", trackType: "Q55850643" });
    expect(applyMbForm(next, releaseToForm(RELEASE, NONE)).settings.trackType).toBe("Q55850593");
    const audio = { ...EXAMPLE, settings: { ...EXAMPLE.settings, trackType: "Q7302866" } };
    expect(applyMbForm(audio, releaseToForm(RELEASE, NONE)).settings.trackType).toBe("Q7302866");
  });

  it("starts a studio album's tracks as studio recordings, and a live album's as live ones", () => {
    const studio = applyMbForm(EXAMPLE, releaseToForm(RELEASE, NONE));
    expect(studio.settings.recTypes).toEqual(["Q15975575"]);
    const live = release();
    live["release-group"]["secondary-types"] = ["Live"];
    expect(applyMbForm(EXAMPLE, releaseToForm(live, NONE)).settings.recTypes).toEqual([
      "Q56123235",
    ]);
    const compilation = release();
    compilation["release-group"]["secondary-types"] = ["Compilation"];
    expect(applyMbForm(EXAMPLE, releaseToForm(compilation, NONE)).settings.recTypes).toEqual([]);
    compilation["release-group"]["secondary-types"] = ["Compilation", "Live"];
    expect(applyMbForm(EXAMPLE, releaseToForm(compilation, NONE)).settings.recTypes).toEqual([
      "Q56123235",
    ]);
  });

  it("keeps the tracks", () => {
    const next = applyMbForm(EMPTY, releaseToForm(RELEASE, { ...NONE, albumQid: "Q1" }));
    expect(next.discs[0].tracks[0]).toMatchObject({ n: 1, title: "After All", seconds: 252 });
    expect(buildPlan(next).fieldErrs.albumQid).toBe("");
  });
  it("gives a new album's date and Discogs master ID a MusicBrainz reference", () => {
    const next = applyMbForm(
      EMPTY,
      releaseToForm(RELEASE, { ...NONE, artists: { [CRJ]: "Q1" } }, "2026-10-04"),
    );
    const album = buildPlan(next).ops.find((o) => o.op === "create" && o.key === "album");
    const claims = album?.op === "create" ? album.claims : [];
    const rgRef = [
      [
        { property: "P248", value: { type: "item", id: "Q14005" } },
        {
          property: "P436",
          value: { type: "string", value: "b012a117-afa3-4ea3-879f-eeb61b974b0a" },
        },
        {
          property: "P813",
          value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
        },
      ],
    ];
    expect(claims.find((c) => c.property === "P577")?.references).toEqual(rgRef);
    expect(claims.find((c) => c.property === "P1954")?.references).toEqual(rgRef);
    // The release group ID itself goes unreferenced.
    expect(claims.find((c) => c.property === "P436")?.references).toBeUndefined();
  });

  it("adds the Discogs master ID to a new album", () => {
    const next = applyMbForm(EMPTY, releaseToForm(RELEASE, { ...NONE, artists: { [CRJ]: "Q1" } }));
    const album = buildPlan(next).ops.find((o) => o.op === "create" && o.key === "album");
    expect(album?.op === "create" && album.claims).toContainEqual(
      expect.objectContaining({ property: "P1954", value: { type: "string", value: "4348311" } }),
    );
  });
});

describe("normalizeAlbumId", () => {
  it("reads a MusicBrainz release group ID in lowercase", () => {
    const id = "b012a117-afa3-4ea3-879f-eeb61b974b0a";
    for (const raw of [
      id.toUpperCase(),
      ` ${id} `,
      `https://musicbrainz.org/release-group/${id.toUpperCase()}`,
    ])
      expect(normalizeAlbumId("musicbrainz", raw)).toBe(id);
  });

  it("reads a Discogs master ID from a pasted URL", () => {
    for (const url of [
      "https://www.discogs.com/master/4348311-Carly-Rae-Jepsen-Day-And-Night",
      "https://www.discogs.com/de/master/4348311",
    ])
      expect(normalizeAlbumId("discogs", url)).toBe("4348311");
    expect(normalizeAlbumId("discogs", "https://www.discogs.com/release/12345678")).toBe(
      "https://www.discogs.com/release/12345678",
    );
  });

  it("reads an Apple Music album ID from Apple Music and older iTunes URLs", () => {
    for (const url of [
      "https://music.apple.com/us/album/day-and-night/1820000000",
      "https://music.apple.com/gb/album/1820000000",
      "https://itunes.apple.com/us/album/id1820000000",
      "https://itunes.apple.com/us/album/day-and-night/id1820000000?uo=4",
    ])
      expect(normalizeAlbumId("appleMusic", url)).toBe("1820000000");
  });

  it("reads a Deezer album ID from a Deezer URL", () => {
    for (const url of [
      "https://www.deezer.com/album/790000000",
      "https://www.deezer.com/fr/album/790000000",
    ])
      expect(normalizeAlbumId("deezer", url)).toBe("790000000");
  });

  it("reads a Tidal album ID from a Tidal URL", () => {
    for (const url of [
      "https://tidal.com/album/450000000",
      "https://tidal.com/browse/album/450000000",
    ])
      expect(normalizeAlbumId("tidal", url)).toBe("450000000");
  });

  it("reads an AllMusic album ID from an AllMusic URL", () => {
    for (const url of [
      "https://www.allmusic.com/album/mw0004834138",
      "https://www.allmusic.com/album/day-and-night-mw0004834138",
    ])
      expect(normalizeAlbumId("allmusic", url)).toBe("mw0004834138");
  });
});
