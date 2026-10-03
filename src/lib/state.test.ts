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
});
