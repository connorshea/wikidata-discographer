import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  applyMbForm,
  creditText,
  type MbArtistCredit,
  type MbLookups,
  type MbRelease,
  parseReleaseInput,
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
const NONE: MbLookups = { artists: {}, recordings: {}, works: {} };
const CRJ = "09887aa7-226e-4ecc-9a0c-02d2ae5777e1";
const credit = (...parts: [string, string][]): MbArtistCredit[] =>
  parts.map(([name, joinphrase], i) => ({ name, joinphrase, artist: { id: `a${i}`, name } }));

describe("parseReleaseInput", () => {
  const id = "6d42c8a3-69c3-458c-9f18-f8a503780607";
  it("takes a release URL or a bare ID", () => {
    expect(parseReleaseInput(`https://musicbrainz.org/release/${id}`)).toEqual({ ok: true, id });
    expect(parseReleaseInput(` ${id.toUpperCase()} `)).toEqual({ ok: true, id });
    expect(parseReleaseInput(`https://beta.musicbrainz.org/release/${id}/discids`)).toEqual({
      ok: true,
      id,
    });
  });

  it("takes beta.musicbrainz.org URLs", () => {
    expect(
      parseReleaseInput(
        "https://beta.musicbrainz.org/release/cb9f38e5-1f35-4411-b41a-d1f7ccf3215d",
      ),
    ).toEqual({ ok: true, id: "cb9f38e5-1f35-4411-b41a-d1f7ccf3215d" });
  });

  it("explains a release group or other entity", () => {
    const rg = parseReleaseInput(`https://musicbrainz.org/release-group/${id}`);
    expect(rg).toMatchObject({ ok: false, error: expect.stringMatching(/release group/) });
    expect(parseReleaseInput(`https://musicbrainz.org/artist/${id}`)).toMatchObject({
      ok: false,
      error: "That's a MusicBrainz artist, not a release.",
    });
    expect(parseReleaseInput("Day and Night")).toMatchObject({ ok: false });
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
  });

  it("fills in what the mirror already has", () => {
    const rec = RELEASE.media[0].tracks![1].recording.id;
    const work = RELEASE.media[1].tracks![0].recording.relations![0].work!.id;
    const form = releaseToForm(RELEASE, {
      albumQid: "Q140316456",
      artists: { [CRJ]: "Q52583" },
      recordings: { [rec]: "Q10" },
      works: { [work]: "Q20" },
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
