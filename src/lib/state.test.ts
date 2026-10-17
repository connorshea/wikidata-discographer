import { describe, expect, it } from "vite-plus/test";
import { coerceState, EMPTY } from "./state.ts";
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
    expect(s.discs.map((d) => d.text)).toEqual(EXAMPLE.discs.map((d) => d.text));
    expect(s.artists).toEqual(EXAMPLE.artists);
  });

  it("drops mistyped values", () => {
    const s = coerceState({
      album: { mode: "delete", type: "Q1", form: "nope", ids: { spotify: 5 } },
      artists: { A: "Q1", B: 2 },
      discs: [{ single: { "1": { date: "2020" }, "2": "x" } }],
    });
    expect(s.album).toMatchObject({
      mode: "existing",
      type: "Q482994",
      form: "",
      ids: { spotify: "" },
    });
    expect(s.artists).toEqual({ A: "Q1" });
    expect(s.discs[0].single).toEqual({ "1": { date: "2020", qid: "", discogs: "" } });
  });

  it("gives singles saved before the Discogs field an empty one", () => {
    const s = coerceState({
      discs: [{ single: { "1": { date: "2020", qid: "" }, "2": { qid: "Q30", discogs: "123" } } }],
    });
    expect(s.discs[0].single).toEqual({
      "1": { date: "2020", qid: "", discogs: "" },
      "2": { date: "", qid: "Q30", discogs: "123" },
    });
  });

  it("keeps an album's import source only when it's well-formed", () => {
    const mb = {
      releaseGroup: "b012a117-afa3-4ea3-879f-eeb61b974b0a",
      release: "6d42c8a3-69c3-458c-9f18-f8a503780607",
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
    for (const bad of [{ release: "x" }, { releaseGroup: 5 }, { retrieved: "2026-02-30" }])
      expect(coerceState({ album: { mb: { ...mb, ...bad } } }).album.mb).toBeNull();
    expect(coerceState({ album: {} }).album.mb).toBeNull();
  });

  it("keeps only well-formed imported identifiers", () => {
    const s = coerceState({
      discs: [
        {
          mb: {
            "1": {
              title: "Song",
              recording: "not an mbid",
              work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
              isrcs: ["USUM72604367", "bad", 5, "USUM72604367"],
              spotify: "6RSxVKsgvNIIN6IwYA8GsQ",
              appleMusic: ["1820000002", "apple", "1820000002"],
              deezer: ["69018826", "deezer"],
              tidal: ["454960380", "tidal"],
              length: {
                seconds: 177,
                recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
                retrieved: "2026-10-04",
              },
            },
            "2": "x",
            "3": {
              title: "Other",
              length: {
                seconds: 177,
                recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
                retrieved: "2026-02-30",
              },
            },
            "4": { title: "Third", length: { seconds: 1.5, recording: "x", retrieved: "" } },
            "5": {
              title: "Fourth",
              source: {
                recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
                retrieved: "2026-10-04",
              },
              length: 200,
            },
            "6": {
              title: "Fifth",
              source: { recording: "x", retrieved: "2026-10-04" },
              length: -1,
            },
          },
        },
      ],
    });
    expect(s.discs[0].mb).toEqual({
      "1": {
        title: "Song",
        recording: "",
        work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
        isrcs: ["USUM72604367"],
        spotify: [],
        appleMusic: ["1820000002"],
        deezer: ["69018826"],
        tidal: ["454960380"],
        // Saved before identifiers had references, so the source comes from the length.
        source: { recording: "519d8f15-518b-479c-af8d-664fb3ae455a", retrieved: "2026-10-04" },
        length: 177,
      },
      "3": {
        title: "Other",
        recording: "",
        work: "",
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        source: null,
        length: 177,
      },
      "4": {
        title: "Third",
        recording: "",
        work: "",
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        source: null,
        length: null,
      },
      "5": {
        title: "Fourth",
        recording: "",
        work: "",
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        source: { recording: "519d8f15-518b-479c-af8d-664fb3ae455a", retrieved: "2026-10-04" },
        length: 200,
      },
      "6": {
        title: "Fifth",
        recording: "",
        work: "",
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        source: null,
        length: null,
      },
    });
  });
});
