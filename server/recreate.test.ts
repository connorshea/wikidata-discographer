import { describe, expect, it } from "vite-plus/test";
import { recreatedItems } from "./recreate.ts";
import { buildPlan, type State } from "../src/lib/plan.ts";
import { coerceState } from "../src/lib/state.ts";
import { EXAMPLE } from "../src/lib/example.fixture.ts";

const copy = (s: State) => coerceState(structuredClone(s));
const opsOf = (s: State) => buildPlan(s).ops;

/** EXAMPLE as a new album, with no external IDs. */
function newAlbum(): State {
  const s = copy(EXAMPLE);
  s.album.mode = "create";
  s.album.qid = "";
  return s;
}

describe("recreatedItems", () => {
  it("finds the items an existing album's last run created", () => {
    const last = {
      input: EXAMPLE,
      albumQid: "Q140316456",
      created: [
        { key: "comp:0:2", qid: "Q1" },
        { key: "track:0:2", qid: "Q2" },
      ],
    };
    const s = copy(EXAMPLE);
    expect(recreatedItems(opsOf(s), s, last)).toEqual([
      { key: "comp:0:2", qid: "Q1", what: "composition “Habits of Creatures”" },
      { key: "track:0:2", qid: "Q2", what: "track “Habits of Creatures”" },
    ]);
  });

  it("leaves out items the form already uses", () => {
    const s = copy(EXAMPLE);
    s.discs[0].comp["2"] = "Q1";
    const last = {
      input: EXAMPLE,
      albumQid: "Q140316456",
      created: [{ key: "comp:0:2", qid: "Q1" }],
    };
    expect(recreatedItems(opsOf(s), s, last)).toEqual([]);
  });

  it("finds a new album and its items, matched by the album's title", () => {
    const s = newAlbum();
    const last = {
      input: newAlbum(),
      albumQid: "Q9",
      created: [
        { key: "album", qid: "Q9" },
        { key: "comp:1:1", qid: "Q10" },
      ],
    };
    expect(recreatedItems(opsOf(s), s, last).map((r) => r.key)).toEqual(["album", "comp:1:1"]);
    // The form already uses the album the last run created.
    const existing = copy(EXAMPLE);
    existing.album.qid = "Q9";
    expect(recreatedItems(opsOf(existing), existing, last).map((r) => r.key)).toEqual(["comp:1:1"]);
  });

  it("ignores another album's run, even with the same plan keys", () => {
    const other = newAlbum();
    other.album.title = "Emotion";
    const s = newAlbum();
    const created = [
      { key: "album", qid: "Q9" },
      { key: "comp:0:2", qid: "Q10" },
    ];
    expect(recreatedItems(opsOf(s), s, { input: other, albumQid: "Q9", created })).toEqual([]);
    const elsewhere = copy(EXAMPLE);
    elsewhere.album.qid = "Q123";
    expect(
      recreatedItems(opsOf(elsewhere), elsewhere, {
        input: EXAMPLE,
        albumQid: "Q140316456",
        created,
      }),
    ).toEqual([]);
  });

  it("ignores a key that's another song now", () => {
    const s = copy(EXAMPLE);
    s.discs[0].tracks[1].title = "Something Else";
    const last = {
      input: EXAMPLE,
      albumQid: "Q140316456",
      created: [{ key: "comp:0:2", qid: "Q1" }],
    };
    expect(recreatedItems(opsOf(s), s, last)).toEqual([]);
  });
});
