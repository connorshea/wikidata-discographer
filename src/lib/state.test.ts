import { describe, expect, it } from "vite-plus/test";
import { coerceState, EMPTY, EXAMPLE } from "./state.ts";

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
    expect(s.discs[0].single).toEqual({ "1": { date: "2020", qid: "" } });
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
        length: {
          seconds: 177,
          recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
          retrieved: "2026-10-04",
        },
      },
      "3": { title: "Other", recording: "", work: "", isrcs: [], spotify: [], length: null },
      "4": { title: "Third", recording: "", work: "", isrcs: [], spotify: [], length: null },
    });
  });

  it("moves a saved form on the old track description default to the new one", () => {
    const old = "vocal track by {artists}, {year} studio recording";
    expect(coerceState({ settings: { trackDesc: old } }).settings.trackDesc).toBe(
      "vocal track by {artists}",
    );
    const own = "{year} track by {artists}";
    expect(coerceState({ settings: { trackDesc: own } }).settings.trackDesc).toBe(own);
  });
});
