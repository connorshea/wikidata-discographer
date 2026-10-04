import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  applyMbForm,
  creditText,
  type MbArtistCredit,
  type MbLookups,
  type MbRelease,
  type MbReleaseListing,
  parseMbInput,
  releaseChoices,
  releaseIds,
  releaseToForm,
  wikidataLink,
} from "./musicbrainz.ts";
import { buildPlan, parseDisc } from "./plan.ts";
import { EMPTY, EXAMPLE } from "./state.ts";

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

describe("creditText", () => {
  it("keeps join phrases the tracklist parser splits on", () => {
    expect(creditText(credit(["A", " feat. "], ["B", " & "], ["C", ""]))).toBe("A feat. B & C");
  });

  it("uses a comma for join phrases it doesn't", () => {
    expect(creditText(credit(["A", " x "], ["B", " and "], ["C", ""]))).toBe("A, B, C");
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
    const form = releaseToForm(RELEASE, NONE);
    expect(form.album).toEqual({
      mode: "create",
      qid: "",
      title: "Day and Night",
      artists: "Carly Rae Jepsen",
      type: "Q482994",
      form: "Q208569",
      ids: { spotify: "", musicbrainz: "b012a117-afa3-4ea3-879f-eeb61b974b0a", appleMusic: "" },
    });
    expect(form.date).toBe("2026-09-18");
    expect(form.p407).toBe("Q1860");
    expect(form.discs.map((d) => d.part)).toEqual(["Q61629664", "Q61629680"]);
    expect(form.discs[0].text).toBe(
      [
        "1. After All - Carly Rae Jepsen (4:12)",
        "2. Habits of Creatures - Carly Rae Jepsen (2:57)",
        "3. Versailles - Carly Rae Jepsen (3:14)",
      ].join("\n"),
    );
    expect(form.notes).toEqual([]);
    expect(form.summary).toMatch(/^Loaded 2 discs and 6 tracks\. Found nothing else/);
    expect(form.summary).toContain(
      "New tracks get 6 recording IDs, 6 ISRCs and 1 Spotify track ID, and 6 new compositions get their work ID",
    );
  });

  it("keeps each track's identifiers with its title", () => {
    const [first] = releaseToForm(RELEASE, NONE, "2026-10-04").discs;
    expect(first.mb["1"]).toEqual({
      title: "After All",
      recording: "263340e1-2f03-4b31-b404-a06a8acda193",
      work: "2bf1a377-686f-426a-ab5a-309466d201e9",
      isrcs: ["USUM72604366"],
      spotify: ["6HSinPEEP7FeS2k1y7BD7j"],
      length: {
        seconds: 252,
        recording: "263340e1-2f03-4b31-b404-a06a8acda193",
        retrieved: "2026-10-04",
      },
    });
    expect(Object.keys(first.mb)).toEqual(["1", "2", "3"]);
  });

  it("keeps the length's source even when an item already has the recording ID", () => {
    const t = RELEASE.media[0].tracks![0];
    const form = releaseToForm(RELEASE, { ...NONE, taken: [t.recording.id] });
    expect(form.discs[0].mb["1"].length?.recording).toBe(t.recording.id);
    const noLength = structuredClone(RELEASE);
    noLength.media[0].tracks![0].length = null;
    expect(releaseToForm(noLength, NONE).discs[0].mb["1"].length).toBeNull();
  });

  it("leaves out identifiers an item already has", () => {
    const t = RELEASE.media[0].tracks![0];
    const work = t.recording.relations!.find((r) => r.work)!.work!.id;
    const form = releaseToForm(RELEASE, {
      ...NONE,
      taken: [t.recording.id, work, "6HSinPEEP7FeS2k1y7BD7j"],
    });
    expect(form.discs[0].mb["1"]).toMatchObject({
      recording: "",
      work: "",
      isrcs: ["USUM72604366"],
      spotify: [],
    });
  });

  it("doesn't count identifiers for rows that reuse an existing track", () => {
    const rec = RELEASE.media[0].tracks![0].recording.id;
    const form = releaseToForm(RELEASE, { ...NONE, recordings: { [rec]: "Q10" }, taken: [rec] });
    expect(form.summary).toContain("New tracks get 5 recording IDs and 5 ISRCs, and");
  });

  it("fills in what the mirror already has", () => {
    const rec = RELEASE.media[0].tracks![1].recording.id;
    const work = RELEASE.media[1].tracks![0].recording.relations![0].work!.id;
    const form = releaseToForm(RELEASE, {
      albumQid: "Q140316456",
      artists: { [CRJ]: "Q52583" },
      recordings: { [rec]: "Q10" },
      works: { [work]: "Q20" },
      taken: [],
    });
    expect(form.album).toMatchObject({ mode: "existing", qid: "Q140316456" });
    expect(form.artists).toEqual({ "Carly Rae Jepsen": "Q52583" });
    expect(form.discs[0].track).toEqual({ "2": "Q10" });
    expect(form.discs[1].comp).toEqual({ "1": "Q20" });
    expect(form.summary).toContain("already on Wikidata as Q140316456");
    expect(form.summary).toContain("Found 1 artist, 1 composition and 1 track");
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
    ];
    const { album } = releaseToForm(r, NONE);
    expect(album).toMatchObject({ type: "Q169930", form: "Q209939" });
    expect(album.ids).toMatchObject({
      spotify: "4aawyAB9vmqN3uQ7FjRGTy",
      appleMusic: "1820000000",
    });
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
    expect(form.discs[0].text.split("\n")[0]).toBe("1. After All - Carly Rae Jepsen");
    expect(form.notes).toEqual([
      "1 track has no length on MusicBrainz, so it gets no duration.",
      expect.stringContaining("“Simon & Garfunkel” has a comma"),
      expect.stringContaining("a Single, not an album or EP"),
      expect.stringContaining("language (fin)"),
    ]);
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
    expect(form.notes[0]).toBe("1 medium has no tracks on MusicBrainz and was left out.");
  });
});

describe("applyMbForm", () => {
  it("replaces the form but keeps the other settings", () => {
    const state = { ...structuredClone(EXAMPLE), settings: { ...EXAMPLE.settings, lang: "fr" } };
    const next = applyMbForm(state, releaseToForm(RELEASE, NONE));
    expect(next.settings).toMatchObject({ lang: "fr", date: "2026-09-18", p407: "Q1860" });
    expect(next.album.mode).toBe("create");
    expect(next.discs).toHaveLength(2);
    expect(next.discs[0].comp).toEqual({});
  });

  it("makes a form the tracklist parser reads", () => {
    const next = applyMbForm(EMPTY, releaseToForm(RELEASE, { ...NONE, albumQid: "Q1" }));
    const rows = next.discs.flatMap((d) => parseDisc(d.text, next.settings));
    expect(rows.every((r) => r.error === undefined)).toBe(true);
    expect(rows[0]).toMatchObject({ n: 1, title: "After All", seconds: 252 });
    expect(buildPlan(next).fieldErrs.albumQid).toBe("");
  });
});
