import { describe, expect, it } from "vite-plus/test";
import { artistsText, coerceState, EMPTY, parseArtists } from "./state.ts";
import { EXAMPLE } from "./example.fixture.ts";

describe("coerceState", () => {
  it("fills anything missing with defaults", () => {
    expect(coerceState(null)).toEqual({
      ...EMPTY,
      settings: { ...EMPTY.settings, langCustom: false, p407Custom: false },
    });
    expect(coerceState({ discs: [] }).discs).toHaveLength(1);
  });

  it("keeps a valid state", () => {
    const s = coerceState(JSON.parse(JSON.stringify(EXAMPLE)));
    expect(s.discs.map((d) => d.tracks)).toEqual(EXAMPLE.discs.map((d) => d.tracks));
    expect(s.artists).toEqual(EXAMPLE.artists);
  });

  it("ignores the saved settings that are now always on", () => {
    const s = coerceState({ settings: { duration: false, mbRefs: false, splitArtists: true } });
    expect(s.settings).toEqual(coerceState(null).settings);
    expect(s.settings).not.toHaveProperty("duration");
    expect(s.settings).not.toHaveProperty("mbRefs");
    expect(s.settings).not.toHaveProperty("splitArtists");
  });

  it("keeps the starting point, or none when it's mistyped", () => {
    expect(coerceState({ start: "search" }).start).toBe("search");
    expect(coerceState({ start: null }).start).toBeNull();
    expect(coerceState({ start: "nope", album: { qid: "Q1" } }).start).toBeNull();
  });

  it("gives a form saved before starting points the one it looks started from", () => {
    expect(coerceState({}).start).toBeNull();
    expect(coerceState({ album: { qid: "Q1" } }).start).toBe("existing");
    expect(coerceState({ album: { mode: "create", title: "A" } }).start).toBe("new");
    expect(coerceState({ settings: { date: "2020-01-01" } }).start).toBe("new");
    const { start: _, ...saved } = EXAMPLE;
    expect(coerceState(JSON.parse(JSON.stringify(saved))).start).toBe("existing");
    const mb = {
      releaseGroup: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
      release: "6d42c8a3-69c3-458c-9f18-f8a503780607",
      retrieved: "2026-10-04",
    };
    expect(coerceState({ album: { qid: "Q1", mb } }).start).toBe("mb");
  });

  it("keeps a track's type and MusicBrainz attributes only when the form knows them", () => {
    const [kept, dropped] = coerceState({
      discs: [
        {
          tracks: [
            { n: 1, title: "A", type: "Q55850643", mb: { attributes: ["live", "nope", 3] } },
            { n: 2, title: "B", type: "Q5", mb: { attributes: [] } },
          ],
        },
      ],
    }).discs[0].tracks;
    expect(kept.type).toBe("Q55850643");
    expect(kept.mb?.attributes).toEqual(["live"]);
    expect(dropped).not.toHaveProperty("type");
    expect(dropped.mb).not.toHaveProperty("attributes");
  });

  it("keeps a track's own language, a QID typed in and the work's languages", () => {
    const [own, typed, none] = coerceState({
      discs: [
        {
          tracks: [
            { n: 1, title: "A", p407: "Q5287", mb: { languages: ["Q1860", "eng", 5] } },
            { n: 2, title: "B", p407: "Q", p407Custom: true },
            { n: 3, title: "C", p407: 4, p407Custom: "yes" },
          ],
        },
      ],
    }).discs[0].tracks;
    expect(own).toMatchObject({ p407: "Q5287", mb: { languages: ["Q1860"] } });
    expect(typed).toMatchObject({ p407: "Q", p407Custom: true });
    expect(none).not.toHaveProperty("p407");
    expect(none).not.toHaveProperty("p407Custom");
  });

  it("keeps a track's recording dates when they're dates", () => {
    const [kept, dropped, impossible, sameDay] = coerceState({
      discs: [
        {
          tracks: [
            {
              n: 1,
              title: "A",
              recorded: "2025-13",
              mb: { recorded: { begin: "2025-11", end: 3 } },
            },
            { n: 2, title: "B", recorded: " ", mb: { recorded: { begin: "Nov 2025" } } },
            { n: 3, title: "C", mb: { recorded: { begin: "2025-02-31" } } },
            { n: 4, title: "D", mb: { recorded: { begin: "2025-11", end: "2025-11" } } },
          ],
        },
      ],
    }).discs[0].tracks;
    // What's typed is kept, for the form to say what's wrong with it.
    expect(kept).toMatchObject({
      recorded: "2025-13",
      mb: { recorded: { begin: "2025-11", end: "" } },
    });
    expect(dropped).not.toHaveProperty("recorded");
    expect(dropped.mb).not.toHaveProperty("recorded");
    expect(impossible.mb).not.toHaveProperty("recorded");
    expect(sameDay.mb?.recorded).toEqual({ begin: "2025-11", end: "" });
  });

  it("keeps the places imported, and a track's own place as typed", () => {
    const ARENA = "3e325c9f-d5a9-4280-a60b-ef77c34e9d17";
    const s = coerceState({
      settings: { recAt: "Q1" },
      places: {
        [ARENA]: { name: " Kia Center ", qid: "Q481795" },
        nope: { name: "X" },
        [ARENA.replace("3e", "4e")]: { name: "" },
      },
      discs: [
        {
          tracks: [
            { n: 1, title: "A", recAt: "Q2", mb: { places: [ARENA, "nope", ARENA] } },
            { n: 2, title: "B", recAt: " ", mb: { places: "x" } },
          ],
        },
      ],
    });
    expect(s.settings.recAt).toBe("Q1");
    expect(s.places).toEqual({ [ARENA]: { name: "Kia Center", qid: "Q481795" } });
    const [a, b] = s.discs[0].tracks;
    expect(a).toMatchObject({ recAt: "Q2", mb: { places: [ARENA] } });
    expect(b).not.toHaveProperty("recAt");
    expect(b.mb).not.toHaveProperty("places");
    expect(coerceState({}).places).toEqual({});
  });

  it("keeps only the recording types the form lists", () => {
    const s = coerceState({
      settings: { recTypes: ["Q56123235", "Q1", "Q15975575"] },
      discs: [
        {
          tracks: [
            { n: 1, title: "A", recTypes: ["Q5", "Q155171"] },
            { n: 2, title: "B", recTypes: ["Q5"] },
            { n: 3, title: "C", recTypes: [] },
          ],
        },
      ],
    });
    expect(s.settings.recTypes).toEqual(["Q15975575", "Q56123235"]);
    expect(s.discs[0].tracks[0].recTypes).toEqual(["Q155171"]);
    // Only types it doesn't know aren't a choice of none, so the album's apply.
    expect(s.discs[0].tracks[1]).not.toHaveProperty("recTypes");
    expect(s.discs[0].tracks[2].recTypes).toEqual([]);
  });

  it("drops mistyped values", () => {
    const s = coerceState({
      album: { mode: "delete", type: "Q1", form: "nope", ids: { spotify: 5 } },
      artists: { A: "Q1", B: 2 },
      discs: [{ single: { "1": { date: "2020" } } }],
    });
    expect(s.album).toMatchObject({
      mode: "existing",
      type: "Q482994",
      form: "",
      ids: { spotify: "" },
    });
    expect(s.artists).toEqual({ A: "Q1" });
    // Tracks don't have singles any more.
    expect(s.discs[0]).not.toHaveProperty("single");
  });

  it("keeps an album's import source only when it's well-formed", () => {
    const mb = {
      releaseGroup: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
      release: "6d42c8a3-69c3-458c-9f18-f8a503780607",
      releaseGroupName: "Day and Night",
      retrieved: "2026-10-04",
      date: { value: "2026-09-18", from: "releaseGroup" },
      ids: {
        spotify: { value: "4aawyAB9vmqN3uQ7FjRGTy", from: "release" },
        appleMusic: { value: "1820000000", from: "elsewhere" },
        discogs: "4348311",
        nope: { value: "1", from: "release" },
        // The release group ID never cites itself.
        musicbrainz: { value: "b012a117-afa3-4ea3-879f-eeb61b974b0a", from: "releaseGroup" },
      },
    };
    expect(coerceState({ album: { mb } }).album.mb).toEqual({
      ...mb,
      ids: { spotify: { value: "4aawyAB9vmqN3uQ7FjRGTy", from: "release" } },
    });
    expect(coerceState({ album: { mb: { ...mb, date: { value: "" } } } }).album.mb?.date).toBe(
      null,
    );
    // A form saved before release group names has none.
    const { releaseGroupName: _, ...unnamed } = mb;
    expect(coerceState({ album: { mb: unnamed } }).album.mb?.releaseGroupName).toBe("");
    for (const bad of [{ release: "x" }, { releaseGroup: 5 }, { retrieved: "2026-02-30" }])
      expect(coerceState({ album: { mb: { ...mb, ...bad } } }).album.mb).toBeNull();
    expect(coerceState({ album: {} }).album.mb).toBeNull();
  });

  it("keeps the release the form was loaded from", () => {
    const release = "6d42c8a3-69c3-458c-9f18-f8a503780607";
    expect(coerceState({ album: { release } }).album.release).toBe(release);
    expect(coerceState({ album: { release: "x" } }).album.release).toBe("");
    // A form saved before it was kept on its own has it in a new album's references.
    const mb = {
      releaseGroup: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
      release,
      retrieved: "2026-10-04",
    };
    expect(coerceState({ album: { mb } }).album.release).toBe(release);
  });

  it("keeps featured artists that are among the row's artists", () => {
    const track = (feat: unknown) =>
      coerceState({ discs: [{ tracks: [{ n: 1, title: "Song", artists: ["A", "B"], feat }] }] })
        .discs[0].tracks[0];
    expect(track(["B", "C", 5]).feat).toEqual(["B"]);
    expect(track(["C"])).not.toHaveProperty("feat");
    expect(track("B")).not.toHaveProperty("feat");
  });

  it("keeps a length typed by hand, even one that isn't valid yet", () => {
    const tracks = (length: unknown) =>
      coerceState({
        discs: [{ tracks: [{ n: 1, title: "Song", artists: [], seconds: 177, length }] }],
      }).discs[0].tracks;
    expect(tracks("3:2")[0]).toMatchObject({ seconds: 177, length: "3:2" });
    expect(tracks(5)[0]).not.toHaveProperty("length");
  });

  it("keeps only well-formed tracks and imported identifiers", () => {
    const s = coerceState({
      discs: [
        {
          tracks: [
            {
              n: 1,
              title: "Song",
              artists: ["A", 5, " ", "B"],
              seconds: 177,
              mb: {
                recording: "not an mbid",
                work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
                recordingName: 5,
                workName: "Song",
                iswcs: [],
                isrcs: ["USUM72604367", "bad", 5, "USUM72604367"],
                spotify: "6RSxVKsgvNIIN6IwYA8GsQ",
                appleMusic: ["1820000002", "apple", "1820000002"],
                deezer: ["69018826", "deezer"],
                tidal: ["454960380", "tidal"],
                composers: [
                  { id: "09887aa7-226e-4ecc-9a0c-02d2ae5777e1", name: " Carly Rae Jepsen " },
                  { id: "09887aa7-226e-4ecc-9a0c-02d2ae5777e1", name: "Carly Rae Jepsen" },
                  { id: "not an mbid", name: "Someone" },
                  { id: "4e56b69b-9146-413c-bd04-78a564073df9", name: "" },
                  "x",
                ],
                lyricists: "Carly Rae Jepsen",
                source: {
                  recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
                  retrieved: "2026-02-30",
                },
              },
            },
            { n: 2, title: "Two", seconds: 1.5, mb: "x" },
            { n: "3", title: "Not a track" },
            "x",
          ],
        },
      ],
    });
    expect(s.discs[0].tracks).toEqual([
      {
        n: 1,
        title: "Song",
        artists: ["A", "B"],
        seconds: 177,
        mb: {
          recording: "",
          work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
          recordingName: "",
          workName: "Song",
          iswcs: [],
          isrcs: ["USUM72604367"],
          spotify: [],
          appleMusic: ["1820000002"],
          deezer: ["69018826"],
          tidal: ["454960380"],
          composers: [{ id: "09887aa7-226e-4ecc-9a0c-02d2ae5777e1", name: "Carly Rae Jepsen" }],
          lyricists: [],
          source: null,
        },
      },
      { n: 2, title: "Two", artists: [], seconds: null, mb: null },
    ]);
  });

  it("reads a disc saved as a tracklist with a line per track", () => {
    const ids = (title: string) => ({
      title,
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      isrcs: ["USUM72604367"],
      // Saved before identifiers had references, so the source comes from the length.
      length: {
        seconds: 177,
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        retrieved: "2026-10-04",
      },
    });
    const disc = {
      text: "1. Song - A & B (2:57)\nnonsense\n\n02. Other - C feat. D\n3. Renamed - A (1:02:03)",
      mb: { "1": ids("song"), "2": ids("Other"), "3": ids("Before") },
    };
    const mb = {
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      work: "",
      recordingName: "",
      workName: "",
      iswcs: [],
      isrcs: ["USUM72604367"],
      spotify: [],
      appleMusic: [],
      deezer: [],
      tidal: [],
      composers: [],
      lyricists: [],
      source: { recording: "519d8f15-518b-479c-af8d-664fb3ae455a", retrieved: "2026-10-04" },
    };
    expect(coerceState({ discs: [disc] }).discs[0].tracks).toEqual([
      { n: 1, title: "Song", artists: ["A", "B"], seconds: 177, mb },
      { n: 2, title: "Other", artists: ["C", "D"], feat: ["D"], seconds: null, mb },
      // Its identifiers were for another title.
      { n: 3, title: "Renamed", artists: ["A"], seconds: 3723, mb: null },
    ]);
    const unsplit = coerceState({ settings: { splitArtists: false }, discs: [disc] });
    expect(unsplit.discs[0].tracks[0].artists).toEqual(["A & B"]);
  });

  it("reads album artists saved as one field", () => {
    const album = (artists: string, settings = {}) =>
      coerceState({
        settings,
        album: { artists },
        artists: { "Tyler, the Creator": "", "Earth, Wind & Fire": "Q1", Earth: "Q2" },
      }).album.artists;
    expect(album("A, B & C feat. D")).toEqual(["A", "B", "C", "D"]);
    // Names the Performers table has stay whole.
    expect(album("Tyler, the Creator & A$AP Rocky")).toEqual(["Tyler, the Creator", "A$AP Rocky"]);
    expect(album("Earth, Wind & Fire feat. B")).toEqual(["Earth, Wind & Fire", "B"]);
    expect(album(" A & B ", { splitArtists: false })).toEqual(["A & B"]);
    expect(album("")).toEqual([]);
    expect(coerceState({ album: { artists: ["A", 5, ""] } }).album.artists).toEqual(["A", ""]);
  });
});

describe("parseArtists", () => {
  it("splits the names, and keeps those after feat. as featured", () => {
    expect(parseArtists("A & B")).toEqual({ artists: ["A", "B"] });
    expect(parseArtists("A, B feat. C & D")).toEqual({
      artists: ["A", "B", "C", "D"],
      feat: ["C", "D"],
    });
    expect(parseArtists("A ft. B")).toEqual({ artists: ["A", "B"], feat: ["B"] });
    expect(parseArtists("A featuring A")).toEqual({ artists: ["A"] });
    expect(parseArtists("Tyler, the Creator feat. B", ["Tyler, the Creator"])).toEqual({
      artists: ["Tyler, the Creator", "B"],
      feat: ["B"],
    });
    expect(parseArtists("")).toEqual({ artists: [] });
  });

  it("reads back what artistsText writes", () => {
    for (const t of [{ artists: ["A", "B"] }, { artists: ["A", "C", "B"], feat: ["C"] }])
      expect(parseArtists(artistsText(t))).toEqual(
        t.feat ? { artists: ["A", "B", "C"], feat: ["C"] } : t,
      );
    expect(artistsText({ artists: [] })).toBe("");
  });
});
