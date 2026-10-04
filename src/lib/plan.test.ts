import { describe, expect, it } from "vite-plus/test";
import {
  buildPlan,
  MAX_TERM_LENGTH,
  MAX_TRACKS,
  MAX_TRACKS_PER_DISC,
  normalizeDate,
  normalizeQid,
  type Op,
  parseDisc,
  splitArtists,
} from "./plan.ts";
import { EMPTY, emptyDisc, EXAMPLE } from "./state.ts";

const keys = (ops: Op[]) => ops.map((o) => (o.op === "create" ? o.key : `+${o.what}`));
const find = (ops: Op[], key: string) => ops.find((o) => o.op === "create" && o.key === key);

describe("normalizeDate", () => {
  it("converts written-out English dates to ISO", () => {
    expect(normalizeDate("June 12, 2012")).toBe("2012-06-12");
    expect(normalizeDate(" jun 2 2012 ")).toBe("2012-06-02");
    expect(normalizeDate("Sept. 3rd, 1999")).toBe("1999-09-03");
    expect(normalizeDate("12 June 2012")).toBe("2012-06-12");
    expect(normalizeDate("1st of March, 2001")).toBe("2001-03-01");
    expect(normalizeDate("June 2012")).toBe("2012-06");
  });

  it("leaves anything else for parseDate to judge", () => {
    for (const s of ["", "2012-06-12", "2012", "Junk 12, 2012", "Ju 12, 2012", "June 12"])
      expect(normalizeDate(s)).toBe(s);
    expect(normalizeDate("February 30, 2012")).toBe("2012-02-30");
  });
});

describe("normalizeQid", () => {
  it("turns URLs and lowercase q-numbers into bare QIDs", () => {
    expect(normalizeQid("https://www.wikidata.org/wiki/Q52583")).toBe("Q52583");
    expect(normalizeQid(" q42 ")).toBe("Q42");
    expect(normalizeQid("not a qid")).toBe("not a qid");
  });
});

describe("splitArtists", () => {
  it("splits on commas, ampersands and feat.", () => {
    expect(splitArtists("A, B & C feat. D", true)).toEqual(["A", "B", "C", "D"]);
    expect(splitArtists("A & B", false)).toEqual(["A & B"]);
  });
});

describe("parseDisc", () => {
  it("reads tracks and flags unreadable lines", () => {
    const rows = parseDisc("1. Song - Artist (3:05)\n\nnonsense", EMPTY.settings);
    expect(rows[0]).toMatchObject({ n: 1, title: "Song", artists: ["Artist"], seconds: 185 });
    expect(rows[1]).toMatchObject({ error: expect.any(String), raw: "nonsense" });
  });

  it("reads a line without a length", () => {
    const rows = parseDisc("1. Song (Live) - A & B\n2. Two - C (1:02:03)", EMPTY.settings);
    expect(rows[0]).toMatchObject({ title: "Song (Live)", artists: ["A", "B"], seconds: null });
    expect(rows[1]).toMatchObject({ title: "Two", artists: ["C"], seconds: 3723 });
  });
});

describe("buildPlan", () => {
  it("is not ready for an empty form", () => {
    const plan = buildPlan(EMPTY);
    expect(plan.ready).toBe(false);
    expect(plan.ops).toEqual([]);
  });

  it("orders compositions, then tracks, then the album tracklist", () => {
    const plan = buildPlan(EXAMPLE);
    expect(plan.ready).toBe(true);
    const k = keys(plan.ops);
    // Disc 1 track 1 reuses an existing composition, so it only gains P175.
    expect(plan.ops[0]).toMatchObject({ op: "addClaims", target: { id: "Q140882264" } });
    expect(k.indexOf("comp:1:12")).toBeLessThan(k.indexOf("track:0:1"));
    expect(k.at(-1)).toBe("+album tracklist");
    expect(plan.ops).toHaveLength(1 + 23 + 24 + 1);
  });

  it("adds no duration to a track without a length", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].text = state.discs[0].text.replace(" (02:57)", "");
    const create = (key: string) =>
      buildPlan(state).ops.find((o) => o.op === "create" && o.key === key);
    const props = (key: string) =>
      (create(key) as { claims: { property: string }[] }).claims.map((c) => c.property);
    expect(props("track:0:2")).not.toContain("P2047");
    expect(props("track:0:3")).toContain("P2047");
  });

  describe("identifiers from a MusicBrainz import", () => {
    const ids = {
      title: "Habits of Creatures",
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
      isrcs: ["USUM72604367"],
      spotify: ["6RSxVKsgvNIIN6IwYA8GsQ"],
      length: {
        seconds: 177,
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        retrieved: "2026-10-04",
      },
    };
    const withIds = () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].mb["2"] = ids;
      return state;
    };
    const claimsOf = (state: typeof EXAMPLE, key: string) =>
      (
        buildPlan(state).ops.find((o) => o.op === "create" && o.key === key) as {
          claims: { property: string; value: { value?: string } }[];
        }
      ).claims
        .filter((c) => ["P4404", "P435", "P1243", "P2207"].includes(c.property))
        .map((c) => [c.property, c.value.value]);

    it("go on the new track and composition", () => {
      expect(claimsOf(withIds(), "track:0:2")).toEqual([
        ["P4404", ids.recording],
        ["P1243", "USUM72604367"],
        ["P2207", "6RSxVKsgvNIIN6IwYA8GsQ"],
      ]);
      expect(claimsOf(withIds(), "comp:0:2")).toEqual([["P435", ids.work]]);
      expect(claimsOf(withIds(), "track:0:3")).toEqual([]);
    });

    it("are left off once the row's title changes, or when the setting is off", () => {
      const renamed = withIds();
      renamed.discs[0].text = renamed.discs[0].text.replace("Habits of Creatures", "Habits");
      expect(claimsOf(renamed, "track:0:2")).toEqual([]);
      const off = withIds();
      off.settings.mbIds = false;
      expect(claimsOf(off, "track:0:2")).toEqual([]);
    });

    it("give the new track's duration a MusicBrainz reference", () => {
      const durationOf = (state: typeof EXAMPLE) => {
        const op = buildPlan(state).ops.find((o) => o.op === "create" && o.key === "track:0:2");
        return op?.op === "create" ? op.claims.find((c) => c.property === "P2047") : undefined;
      };
      expect(durationOf(withIds())?.references).toEqual([
        [
          { property: "P248", value: { type: "item", id: "Q14005" } },
          { property: "P4404", value: { type: "string", value: ids.recording } },
          {
            property: "P813",
            value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
          },
        ],
      ]);
      // Even with identifiers off, but not once the length is edited or references are off.
      const noIds = withIds();
      noIds.settings.mbIds = false;
      expect(durationOf(noIds)?.references).toHaveLength(1);
      const edited = withIds();
      edited.discs[0].text = edited.discs[0].text.replace("(02:57)", "(02:58)");
      expect(durationOf(edited)).toMatchObject({ property: "P2047" });
      expect(durationOf(edited)?.references).toBeUndefined();
      const off = withIds();
      off.settings.mbRefs = false;
      expect(durationOf(off)?.references).toBeUndefined();
    });

    it("match the title ignoring case and curly quotes", () => {
      const state = withIds();
      state.discs[0].mb["2"] = { ...ids, title: "habits  of creatures" };
      expect(claimsOf(state, "track:0:2")).toHaveLength(3);
    });
  });

  it("needs a single's own release date or an existing single, not both", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].single["2"] = { date: "", qid: "" };
    expect(buildPlan(state).singleErrs["0:2"]).toMatch(/Enter the new single's release date/);
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "Q30" };
    expect(buildPlan(state).singleErrs["0:2"]).toMatch(/not both/);
    state.discs[0].single["2"] = { date: "", qid: "Q30" };
    expect(buildPlan(state).singleErrs).toEqual({});
  });

  it("links created items by reference", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "" };
    const { ops, ready } = buildPlan(state);
    expect(ready).toBe(true);
    expect(keys(ops)[0]).toBe("album");

    const track = find(ops, "track:0:2");
    expect(track?.op === "create" && track.claims).toEqual(
      expect.arrayContaining([{ property: "P2550", value: { type: "item", ref: "comp:0:2" } }]),
    );
    expect(track?.op === "create" && track.claims.some((c) => c.property === "P1433")).toBe(false);
    const single = find(ops, "single:0:2");
    expect(single?.op === "create" && single.claims).toEqual(
      expect.arrayContaining([
        { property: "P13602", value: { type: "item", ref: "album" } },
        expect.objectContaining({ property: "P658", value: { type: "item", ref: "track:0:2" } }),
      ]),
    );
    expect(single?.op === "create" && single.claims.some((c) => c.property === "P407")).toBe(false);
    // Nothing adds P1433 to the track afterwards.
    expect(ops.at(-1)).toBe(single);
  });

  it("puts the disc and position on each tracklist statement", () => {
    const { ops } = buildPlan(EXAMPLE);
    const tracklist = ops.at(-1);
    expect(tracklist?.op === "addClaims" && tracklist.claims[12]).toEqual({
      property: "P658",
      value: { type: "item", ref: "track:1:1" },
      qualifiers: [
        { property: "P1545", value: { type: "string", value: "1" } },
        { property: "P518", value: { type: "item", id: "Q61629680" } },
      ],
    });
  });

  it("gives compositions a language but not tracks, and neither a publication date", () => {
    const { ops } = buildPlan(EXAMPLE);
    const has = (key: string, property: string) => {
      const o = find(ops, key);
      return o?.op === "create" && o.claims.some((c) => c.property === property);
    };
    expect(has("comp:0:2", "P407")).toBe(true);
    expect(has("track:0:2", "P407")).toBe(false);
    expect(has("comp:0:2", "P577")).toBe(false);
    expect(has("track:0:2", "P577")).toBe(false);
  });

  it("adds the number of tracks to an existing album only if it has none", () => {
    const tracklist = buildPlan(EXAMPLE).ops.find(
      (o) => o.op === "addClaims" && o.what === "album tracklist",
    );
    const counts =
      tracklist?.op === "addClaims" ? tracklist.claims.filter((c) => c.property === "P2635") : [];
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((c) => c.ifMissing)).toBe(true);
  });

  it("doesn't add the number of tracks again to an album it creates", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    const { ops } = buildPlan(state);
    const tracklist = ops.find((o) => o.op === "addClaims" && o.what === "album tracklist");
    expect(
      tracklist?.op === "addClaims" && tracklist.claims.some((c) => c.property === "P2635"),
    ).toBe(false);
    expect(find(ops, "album")?.op === "create" && find(ops, "album")).toMatchObject({
      claims: expect.arrayContaining([expect.objectContaining({ property: "P2635" })]),
    });
  });

  it("blocks on a bad performer QID", () => {
    const state = structuredClone(EXAMPLE);
    state.artists["Carly Rae Jepsen"] = "Carly";
    expect(buildPlan(state).ready).toBe(false);
  });

  describe("label and description length", () => {
    const errors = (plan: ReturnType<typeof buildPlan>) =>
      plan.messages.filter((m) => m[0] === "err").map((m) => m[1]);
    const titled = (title: string) => {
      const state = structuredClone(EXAMPLE);
      state.album = { ...state.album, mode: "create", title };
      return state;
    };

    it("allows exactly the limit", () => {
      const state = titled("x".repeat(MAX_TERM_LENGTH));
      expect(buildPlan(state).ready).toBe(true);
    });

    it("marks an over-long album title on its field", () => {
      const state = titled("x".repeat(MAX_TERM_LENGTH + 1));
      const plan = buildPlan(state);
      expect(plan.ready).toBe(false);
      expect(plan.fieldErrs.albumTitle).toBe(
        `Wikidata allows ${MAX_TERM_LENGTH} characters at most. This title has ${MAX_TERM_LENGTH + 1}.`,
      );
    });

    it("counts characters, not UTF-16 units", () => {
      const state = titled("🎵".repeat(MAX_TERM_LENGTH));
      expect(buildPlan(state).ready).toBe(true);
    });

    it("names each over-long track title and filled-in description once", () => {
      const state = structuredClone(EXAMPLE);
      const long = "x".repeat(MAX_TERM_LENGTH + 10);
      state.discs = [{ ...emptyDisc(), text: `1. ${long} - Carly Rae Jepsen (3:00)` }];
      state.settings.trackDesc = `${"y".repeat(MAX_TERM_LENGTH)} by {artists}`;
      const plan = buildPlan(state);
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `Wikidata allows ${MAX_TERM_LENGTH} characters at most in a label or description. ` +
          `Too long: the title of track 1.1 (${MAX_TERM_LENGTH + 10}), ` +
          `the track description for track 1.1 (${MAX_TERM_LENGTH + 20}).`,
      ]);
    });
  });

  describe("size limits", () => {
    const tracklist = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `${i + 1}. Song ${i + 1} - Carly Rae Jepsen (3:00)`,
      ).join("\n");
    const withDiscs = (...counts: number[]) => {
      const state = structuredClone(EXAMPLE);
      state.discs = counts.map((n) => ({ ...emptyDisc(), text: tracklist(n) }));
      return state;
    };
    const errors = (plan: ReturnType<typeof buildPlan>) =>
      plan.messages.filter((m) => m[0] === "err").map((m) => m[1]);

    it("allows a full disc and blocks one track more", () => {
      expect(buildPlan(withDiscs(MAX_TRACKS_PER_DISC)).ready).toBe(true);
      const plan = buildPlan(withDiscs(3, MAX_TRACKS_PER_DISC + 1));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `Disc 2 has ${MAX_TRACKS_PER_DISC + 1} tracks, but a disc can have at most ${MAX_TRACKS_PER_DISC}. ` +
          "Split it into more discs, or into separate runs.",
      ]);
    });

    it("allows a full run and blocks one track more across all discs", () => {
      expect(buildPlan(withDiscs(MAX_TRACKS_PER_DISC, MAX_TRACKS_PER_DISC)).ready).toBe(true);
      const plan = buildPlan(withDiscs(MAX_TRACKS_PER_DISC, MAX_TRACKS_PER_DISC, 1));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `That's ${MAX_TRACKS + 1} tracks across all discs, but a run can have at most ${MAX_TRACKS}. ` +
          "Split the release into separate runs.",
      ]);
    });
  });
});
