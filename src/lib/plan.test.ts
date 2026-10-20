import { describe, expect, it } from "vite-plus/test";
import {
  buildPlan,
  citesMb,
  citesMbDate,
  albumDescPreview,
  descPreviews,
  descTypeLabel,
  describeOp,
  loadedReleaseGroup,
  MAX_TERM_LENGTH,
  MAX_TRACKS,
  MAX_TRACKS_PER_DISC,
  normalizeDate,
  normalizeQid,
  type Claim,
  type MbRowIds,
  type Op,
  PARTS,
} from "./plan.ts";
import { EMPTY, emptyDisc } from "./state.ts";
import { EXAMPLE, track } from "./example.fixture.ts";

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

describe("loadedReleaseGroup", () => {
  const RG = "be0d5442-eccd-4114-8bf6-4ae4f5f2f2c1";
  const withRg = (musicbrainz: string, loaded: boolean) => {
    const state = structuredClone(EMPTY);
    state.album.ids.musicbrainz = musicbrainz;
    state.discs = [emptyDisc()];
    state.discs[0].tracks = [track(1, "Get Busy Living", "3:20")];
    if (loaded)
      state.discs[0].tracks[0].mb = {
        recording: "1f0c9a3e-3c2b-4a8e-9b0e-0d6f1c2a3b4c",
        work: "",
        recordingName: "Get Busy Living",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: [],
        lyricists: [],
        source: { recording: "1f0c9a3e-3c2b-4a8e-9b0e-0d6f1c2a3b4c", retrieved: "2026-10-12" },
      };
    return state;
  };

  it("is true once the import has loaded that release group", () => {
    expect(loadedReleaseGroup(withRg(RG, true), RG)).toBe(true);
    expect(
      loadedReleaseGroup(withRg(`https://musicbrainz.org/release-group/${RG}`, true), RG),
    ).toBe(true);
  });

  it("is false when the release group was only typed in for a new album", () => {
    expect(loadedReleaseGroup(withRg(RG, false), RG)).toBe(false);
  });

  it("is false when another release group was loaded", () => {
    expect(loadedReleaseGroup(withRg("0a1b2c3d-0000-4000-8000-000000000000", true), RG)).toBe(
      false,
    );
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
    state.discs[0].tracks[1].seconds = null;
    const create = (key: string) =>
      buildPlan(state).ops.find((o) => o.op === "create" && o.key === key);
    const props = (key: string) =>
      (create(key) as { claims: { property: string }[] }).claims.map((c) => c.property);
    expect(props("track:0:2")).not.toContain("P2047");
    expect(props("track:0:3")).toContain("P2047");
  });

  describe("track types", () => {
    const typeOf = (state: typeof EXAMPLE, key: string) => {
      const op = find(buildPlan(state).ops, key) as { claims: Claim[] };
      return op.claims.find((c) => c.property === "P31")?.value;
    };
    const instrumental = (state: typeof EXAMPLE) => {
      state.discs[0].tracks[1].mb = {
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        work: "",
        recordingName: "",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: [],
        lyricists: [],
        attributes: ["instrumental"],
        source: null,
      };
      return state;
    };

    it("gives a track its own type over the album's", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].type = "Q7302866";
      expect(typeOf(state, "track:0:2")).toEqual({ type: "item", id: "Q7302866" });
      expect(typeOf(state, "track:0:3")).toEqual({ type: "item", id: "Q55850593" });
    });

    it("makes a recording MusicBrainz says is instrumental a track without lyrics", () => {
      const state = instrumental(structuredClone(EXAMPLE));
      expect(typeOf(state, "track:0:2")).toEqual({ type: "item", id: "Q55850643" });
      state.discs[0].tracks[1].type = "Q55850593";
      expect(typeOf(state, "track:0:2")).toEqual({ type: "item", id: "Q55850593" });
    });

    it("cites MusicBrainz for the type only when it gave it", () => {
      const state = instrumental(structuredClone(EXAMPLE));
      state.discs[0].tracks[1].mb!.source = {
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        retrieved: "2026-10-04",
      };
      const p31 = () =>
        (find(buildPlan(state).ops, "track:0:2") as { claims: Claim[] }).claims.find(
          (c) => c.property === "P31",
        );
      expect(p31()?.references).toHaveLength(1);
      state.discs[0].tracks[1].type = "Q55850643";
      expect(p31()).not.toHaveProperty("references");
    });

    it("leaves the album's type with the MusicBrainz details off", () => {
      const state = instrumental(structuredClone(EXAMPLE));
      state.settings.mbDetails = false;
      expect(typeOf(state, "track:0:2")).toEqual({ type: "item", id: "Q55850593" });
    });
  });

  describe("languages", () => {
    const langsOf = (state: typeof EXAMPLE, key: string) => {
      const op = find(buildPlan(state).ops, key) as { claims: Claim[] };
      return op.claims.filter((c) => c.property === "P407");
    };
    const ids = (more: Partial<MbRowIds>): MbRowIds => ({
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
      recordingName: "",
      workName: "",
      iswcs: [],
      isrcs: [],
      spotify: [],
      appleMusic: [],
      deezer: [],
      tidal: [],
      composers: [],
      lyricists: [],
      source: {
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
        retrieved: "2026-10-04",
      },
      ...more,
    });

    it("gives a composition its track's own language, or none", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].p407 = "Q5287";
      state.discs[0].tracks[2].p407 = "";
      expect(langsOf(state, "comp:0:2").map((c) => c.value)).toEqual([
        { type: "item", id: "Q5287" },
      ]);
      expect(langsOf(state, "comp:0:3")).toEqual([]);
      expect(langsOf(state, "comp:0:4").map((c) => c.value)).toEqual([
        { type: "item", id: "Q1860" },
      ]);
    });

    it("uses the work's languages on MusicBrainz, cited to the work", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].mb = ids({ languages: ["Q1321", "Q1860"] });
      const claims = langsOf(state, "comp:0:2");
      expect(claims.map((c) => c.value)).toEqual([
        { type: "item", id: "Q1321" },
        { type: "item", id: "Q1860" },
      ]);
      expect(claims[0].references?.[0]).toContainEqual({
        property: "P435",
        value: { type: "string", value: "c8ee496c-48f7-456a-b5e6-b206eeb37726" },
      });
      state.settings.mbDetails = false;
      expect(langsOf(state, "comp:0:2").map((c) => c.value)).toEqual([
        { type: "item", id: "Q1860" },
      ]);
    });

    it("gives a track without lyrics no linguistic content, unless the work has a language", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].type = "Q55850643";
      expect(langsOf(state, "comp:0:2").map((c) => c.value)).toEqual([
        { type: "item", id: "Q22282939" },
      ]);
      state.discs[0].tracks[1].mb = ids({ languages: ["Q1860"] });
      expect(langsOf(state, "comp:0:2").map((c) => c.value)).toEqual([
        { type: "item", id: "Q1860" },
      ]);
    });

    it("leaves a track without lyrics with no language when the album has none", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.p407 = "";
      state.discs[0].tracks[1].type = "Q55850643";
      expect(langsOf(state, "comp:0:2")).toEqual([]);
    });

    it("doesn't give a track with vocals no linguistic content", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].type = "Q55850593";
      state.discs[0].tracks[1].mb = ids({ languages: ["Q22282939"] });
      expect(langsOf(state, "comp:0:2").map((c) => c.value)).toEqual([
        { type: "item", id: "Q1860" },
      ]);
      Object.assign(state.settings, { p407: "Q22282939", trackType: "Q55850643" });
      expect(langsOf(state, "comp:0:2")).toEqual([]);
      expect(langsOf(state, "comp:0:3").map((c) => c.value)).toEqual([
        { type: "item", id: "Q22282939" },
      ]);
    });

    it("needs a QID for a language typed in", () => {
      const state = structuredClone(EXAMPLE);
      Object.assign(state.discs[0].tracks[1], { p407: "", p407Custom: true });
      Object.assign(state.discs[0].tracks[2], { p407: "Finnish", p407Custom: true });
      const plan = buildPlan(state);
      expect(plan.rowErrs["0:2"].lang).toBe("Enter a QID, or choose another language.");
      expect(plan.rowErrs["0:3"].lang).toBe(`"Finnish" isn't a QID (e.g. Q1860).`);
      expect(plan.ready).toBe(false);
    });
  });

  describe("recording dates", () => {
    const REC = "519d8f15-518b-479c-af8d-664fb3ae455a";
    const recordedOf = (state: typeof EXAMPLE, key: string) => {
      const op = buildPlan(state).ops.find((o) => (o.op === "create" ? o.key : o.what) === key) as {
        claims: Claim[];
      };
      return op.claims.find((c) => c.property === "P10135");
    };
    const withMb = (state: typeof EXAMPLE) => {
      state.discs[0].tracks[1].mb = {
        recording: REC,
        work: "",
        recordingName: "",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: [],
        lyricists: [],
        recorded: { begin: "2025-11-03", end: "2025-11-05" },
        source: { recording: REC, retrieved: "2026-10-04" },
      };
      return state;
    };

    it("adds none without a date", () => {
      expect(recordedOf(structuredClone(EXAMPLE), "track:0:2")).toBeUndefined();
    });

    it("gives a track the album's date, or its own", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.recDate = "2025";
      state.discs[0].tracks[1].recorded = "2025-12";
      expect(recordedOf(state, "track:0:2")?.value).toEqual({
        type: "time",
        time: "+2025-12-00T00:00:00Z",
        precision: 10,
      });
      expect(recordedOf(state, "track:0:3")).toEqual({
        property: "P10135",
        value: { type: "time", time: "+2025-00-00T00:00:00Z", precision: 9 },
      });
    });

    it("uses the first day MusicBrainz has, cited to the recording", () => {
      const state = withMb(structuredClone(EXAMPLE));
      state.settings.recDate = "2025";
      const c = recordedOf(state, "track:0:2");
      expect(c?.value).toEqual({ type: "time", time: "+2025-11-03T00:00:00Z", precision: 11 });
      expect(c?.references?.[0]).toContainEqual({
        property: "P4404",
        value: { type: "string", value: REC },
      });
      state.settings.mbDetails = false;
      expect(recordedOf(state, "track:0:2")?.value).toMatchObject({ precision: 9 });
    });

    it("adds it to an existing track only if it has none", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.recDate = "2025";
      state.discs[0].track[2] = "Q123";
      const where = `track 1.2 “${state.discs[0].tracks[1].title}”`;
      expect(recordedOf(state, where)).toMatchObject({ property: "P10135", ifMissing: true });
    });

    it("checks the dates typed in", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.recDate = "Nov 2025";
      state.discs[0].tracks[1].recorded = "2025-13";
      const plan = buildPlan(state);
      expect(plan.fieldErrs.recDate).toBe("Use YYYY, YYYY-MM or YYYY-MM-DD.");
      expect(plan.rowErrs["0:2"].recorded).toBe("13 isn't a month (01–12).");
      expect(plan.blockers).toContain("settings");
    });

    it("doesn't check a date an existing track won't get", () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].recorded = "2025-13";
      state.discs[0].track[2] = "Q123";
      state.settings.extendExisting = false;
      expect(buildPlan(state).rowErrs["0:2"]?.recorded).toBeUndefined();
      state.settings.extendExisting = true;
      expect(buildPlan(state).rowErrs["0:2"].recorded).toBe("13 isn't a month (01–12).");
    });
  });

  describe("recording types", () => {
    const REC = "519d8f15-518b-479c-af8d-664fb3ae455a";
    const typesOf = (state: typeof EXAMPLE, key: string) => {
      const op = buildPlan(state).ops.find((o) => (o.op === "create" ? o.key : o.what) === key) as {
        claims: Claim[];
      };
      return op.claims.filter((c) => c.property === "P1552");
    };
    const ids = (c: Claim[]) => c.map((x) => (x.value as { id: string }).id);
    const liveCover = (state: typeof EXAMPLE) => {
      state.discs[0].tracks[1].mb = {
        recording: REC,
        work: "",
        recordingName: "",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: [],
        lyricists: [],
        attributes: ["live", "cover"],
        source: { recording: REC, retrieved: "2026-10-04" },
      };
      return state;
    };

    it("adds the album's to every track, unless a track has its own", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.recTypes = ["Q15975575"];
      state.discs[0].tracks[1].recTypes = ["Q214272", "Q60566516"];
      state.discs[0].tracks[2].recTypes = [];
      expect(ids(typesOf(state, "track:0:2"))).toEqual(["Q214272", "Q60566516"]);
      expect(typesOf(state, "track:0:3")).toEqual([]);
      expect(typesOf(state, "track:0:4")).toEqual([
        { property: "P1552", value: { type: "item", id: "Q15975575" } },
      ]);
    });

    it("adds what MusicBrainz says, cited to the recording, with live in place of studio", () => {
      const state = liveCover(structuredClone(EXAMPLE));
      state.settings.recTypes = ["Q15975575", "Q25203386"];
      const claims = typesOf(state, "track:0:2");
      expect(ids(claims)).toEqual(["Q56123235", "Q155171", "Q25203386"]);
      expect(claims.find((c) => ids([c])[0] === "Q155171")?.references).toBeDefined();
      expect(claims.find((c) => ids([c])[0] === "Q25203386")?.references).toBeUndefined();
      state.settings.mbDetails = false;
      expect(ids(typesOf(state, "track:0:2"))).toEqual(["Q15975575", "Q25203386"]);
    });

    it("cites MusicBrainz for what it says, even when the album or the track says it too", () => {
      const state = liveCover(structuredClone(EXAMPLE));
      state.settings.recTypes = ["Q56123235"];
      const cited = () =>
        typesOf(state, "track:0:2")
          .filter((c) => c.references)
          .map((c) => ids([c])[0]);
      expect(cited()).toEqual(["Q56123235", "Q155171"]);
      state.discs[0].tracks[1].recTypes = ["Q56123235", "Q155171", "Q60566516"];
      expect(cited()).toEqual(["Q56123235", "Q155171"]);
    });

    it("doesn't make an instrumental recording an instrumental version", () => {
      const state = liveCover(structuredClone(EXAMPLE));
      state.discs[0].tracks[1].mb!.attributes = ["instrumental"];
      expect(typesOf(state, "track:0:2")).toEqual([]);
    });

    it("adds them to an existing track only if it has none", () => {
      const state = structuredClone(EXAMPLE);
      state.settings.recTypes = ["Q15975575"];
      state.discs[0].track[2] = "Q123";
      const where = `track 1.2 “${state.discs[0].tracks[1].title}”`;
      expect(typesOf(state, where)).toEqual([
        { property: "P1552", value: { type: "item", id: "Q15975575" }, ifMissing: true },
      ]);
    });
  });

  describe("identifiers from a MusicBrainz import", () => {
    const ids = {
      recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
      work: "c8ee496c-48f7-456a-b5e6-b206eeb37726",
      recordingName: "You’re My Woman (original stereo mix)",
      workName: "You’re My Woman",
      iswcs: ["T-345.246.800-1"],
      isrcs: ["USUM72604367"],
      spotify: ["6RSxVKsgvNIIN6IwYA8GsQ"],
      appleMusic: ["1820000002"],
      deezer: ["69018826"],
      tidal: ["454960380"],
      composers: [],
      lyricists: [],
      source: { recording: "519d8f15-518b-479c-af8d-664fb3ae455a", retrieved: "2026-10-04" },
    };
    const MB_REF = [
      [
        { property: "P248", value: { type: "item", id: "Q14005" } },
        { property: "P4404", value: { type: "string", value: ids.recording } },
        {
          property: "P813",
          value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
        },
      ],
    ];
    const withIds = () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].mb = ids;
      return state;
    };
    const claimsOf = (state: typeof EXAMPLE, key: string) =>
      (
        buildPlan(state).ops.find((o) => o.op === "create" && o.key === key) as {
          claims: { property: string; value: { value?: string } }[];
        }
      ).claims
        .filter((c) =>
          ["P4404", "P435", "P1827", "P1243", "P2207", "P10110", "P2724", "P4578"].includes(
            c.property,
          ),
        )
        .map((c) => [c.property, c.value.value]);

    it("go on the new track and composition", () => {
      expect(claimsOf(withIds(), "track:0:2")).toEqual([
        ["P4404", ids.recording],
        ["P1243", "USUM72604367"],
        ["P2207", "6RSxVKsgvNIIN6IwYA8GsQ"],
        ["P10110", "1820000002"],
        ["P2724", "69018826"],
        ["P4578", "454960380"],
      ]);
      expect(claimsOf(withIds(), "comp:0:2")).toEqual([
        ["P435", ids.work],
        ["P1827", "T-345.246.800-1"],
      ]);
      expect(claimsOf(withIds(), "track:0:3")).toEqual([]);
    });

    describe("name the recording and work IDs as MusicBrainz does", () => {
      const idClaim = (state: typeof EXAMPLE, key: string, property: string) => {
        const op = find(buildPlan(state).ops, key);
        return op?.op === "create" ? op.claims.find((c) => c.property === property) : undefined;
      };
      const namedAs = (value: string) => [{ property: "P1810", value: { type: "string", value } }];

      it("with the recording's and the work's names, not the track's title", () => {
        expect(idClaim(withIds(), "track:0:2", "P4404")?.qualifiers).toEqual(
          namedAs("You’re My Woman (original stereo mix)"),
        );
        expect(idClaim(withIds(), "comp:0:2", "P435")?.qualifiers).toEqual(
          namedAs("You’re My Woman"),
        );
      });

      it("keeping MusicBrainz's typographic quotes when titles are straightened", () => {
        const state = withIds();
        state.settings.straight = true;
        expect(idClaim(state, "comp:0:2", "P435")?.qualifiers).toEqual(namedAs("You’re My Woman"));
      });

      it("and leave the qualifier out without a name", () => {
        const state = withIds();
        state.discs[0].tracks[1].mb = { ...ids, recordingName: "", workName: "" };
        expect(idClaim(state, "track:0:2", "P4404")).not.toHaveProperty("qualifiers");
        expect(idClaim(state, "comp:0:2", "P435")).not.toHaveProperty("qualifiers");
      });
    });

    describe("on a reused track and composition", () => {
      const reused = () => {
        const state = withIds();
        state.discs[0].track[2] = "Q101";
        state.discs[0].comp[2] = "Q102";
        return state;
      };
      const added = (state: typeof EXAMPLE, id: string) => {
        const op = buildPlan(state).ops.find(
          (o) => o.op === "addClaims" && "id" in o.target && o.target.id === id,
        );
        return op?.op === "addClaims" ? op.claims : undefined;
      };
      const named = (value: string) => [{ property: "P1810", value: { type: "string", value } }];

      it("add the recording ID to the track, unless it has one", () => {
        expect(added(reused(), "Q101")).toContainEqual({
          property: "P4404",
          value: { type: "string", value: ids.recording },
          qualifiers: named("You’re My Woman (original stereo mix)"),
          ifMissing: true,
        });
      });

      it("add the work ID to the composition, unless it has one", () => {
        expect(added(reused(), "Q102")).toContainEqual({
          property: "P435",
          value: { type: "string", value: ids.work },
          qualifiers: named("You’re My Woman"),
          ifMissing: true,
        });
      });

      it("only the MusicBrainz IDs, not the other identifiers", () => {
        const props = (id: string) => added(reused(), id)!.map((c) => c.property);
        expect(props("Q101")).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/^P(1243|2207|10110|2724|4578)$/)]),
        );
        expect(props("Q102")).not.toContain("P1827");
      });

      it("add the work ID even without a performer to add", () => {
        const state = reused();
        state.settings.compPerformer = false;
        expect(added(state, "Q102")?.map((c) => c.property)).toEqual(["P435"]);
      });

      it("add neither when an item already has the ID it was found by", () => {
        const state = reused();
        state.discs[0].tracks[1].mb = { ...ids, recording: "", work: "" };
        state.settings.compPerformer = false;
        expect(added(state, "Q101")?.map((c) => c.property)).not.toContain("P4404");
        expect(added(state, "Q102")).toBeUndefined();
      });

      it("add neither with Link reused items off", () => {
        const state = reused();
        state.settings.extendExisting = false;
        expect(added(state, "Q101")).toBeUndefined();
        expect(added(state, "Q102")).toBeUndefined();
      });
    });

    describe("of one work on two tracks", () => {
      const shared = () => {
        const state = withIds();
        state.discs[0].tracks[4].mb = { ...ids, recording: "" };
        return state;
      };

      it("block the run", () => {
        const plan = buildPlan(shared());
        expect(plan.ready).toBe(false);
        expect(plan.ops).toEqual([]);
        expect(plan.messages).toContainEqual([
          "err",
          "Tracks 1.2 and 1.5 are performances of the same MusicBrainz work. " +
            "Discographer can't create this album for now.",
        ]);
      });

      it("don't block it when one of them reuses a composition", () => {
        const state = shared();
        state.discs[0].comp[5] = "Q42";
        expect(buildPlan(state).ready).toBe(true);
      });
    });

    it("give the new track's duration a MusicBrainz reference", () => {
      const durationOf = (state: typeof EXAMPLE) => {
        const op = buildPlan(state).ops.find((o) => o.op === "create" && o.key === "track:0:2");
        return op?.op === "create" ? op.claims.find((c) => c.property === "P2047") : undefined;
      };
      expect(durationOf(withIds())?.references).toEqual(MB_REF);
      // A length typed by hand is stated without one.
      const typed = withIds();
      typed.discs[0].tracks[1].length = "3:30";
      expect(durationOf(typed)).toMatchObject({ value: { amount: 210 } });
      expect(durationOf(typed)?.references).toBeUndefined();
    });

    describe("give each ISRC and track ID on the new track a MusicBrainz reference", () => {
      const refsOf = (state: typeof EXAMPLE, key = "track:0:2") => {
        const op = buildPlan(state).ops.find((o) => o.op === "create" && o.key === key);
        return Object.fromEntries(
          (op?.op === "create" ? op.claims : [])
            .filter((c) =>
              ["P4404", "P435", "P1827", "P1243", "P2207", "P10110", "P2724", "P4578"].includes(
                c.property,
              ),
            )
            .map((c) => [c.property, c.references]),
        );
      };
      const only = (key: "isrcs" | "spotify" | "appleMusic" | "deezer" | "tidal") => {
        const state = withIds();
        state.discs[0].tracks[1].mb = {
          ...ids,
          isrcs: [],
          spotify: [],
          appleMusic: [],
          deezer: [],
          tidal: [],
          [key]: ids[key],
        };
        return state;
      };

      it.each([
        ["isrcs", "P1243"],
        ["spotify", "P2207"],
        ["appleMusic", "P10110"],
        ["deezer", "P2724"],
        ["tidal", "P4578"],
      ] as const)("%s (%s)", (key, property) => {
        expect(refsOf(only(key))).toEqual({ P4404: undefined, [property]: MB_REF });
      });

      it("but not the recording or work ID", () => {
        expect(refsOf(withIds()).P4404).toBeUndefined();
        expect(refsOf(withIds(), "comp:0:2").P435).toBeUndefined();
      });

      it("and the ISWC on the new composition", () => {
        expect(refsOf(withIds(), "comp:0:2")).toEqual({ P435: undefined, P1827: MB_REF });
      });

      it("even when an item already has the recording ID", () => {
        const state = withIds();
        state.discs[0].tracks[1].mb = { ...ids, recording: "" };
        expect(refsOf(state).P1243).toEqual(MB_REF);
      });
    });
  });

  describe("composers and lyricists from a MusicBrainz import", () => {
    const WORK = "c8ee496c-48f7-456a-b5e6-b206eeb37726";
    const CRJ = { id: "09887aa7-226e-4ecc-9a0c-02d2ae5777e1", name: "Carly Rae Jepsen" };
    const BERGER = { id: "ffadf26a-2593-4eaf-8c5d-a54cbc5aedc5", name: "Patrik Berger" };
    const withWriters = () => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].tracks[1].mb = {
        recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
        work: WORK,
        recordingName: "",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: [CRJ, BERGER],
        lyricists: [CRJ],
        source: {
          recording: "519d8f15-518b-479c-af8d-664fb3ae455a",
          work: WORK,
          retrieved: "2026-10-04",
        },
      };
      state.artists["Patrik Berger"] = "Q7146018";
      return state;
    };
    const writersOf = (op: Op | undefined) =>
      (op?.claims ?? [])
        .filter((c) => c.property === "P86" || c.property === "P676")
        .map((c) => [c.property, c.value.type === "item" && "id" in c.value ? c.value.id : null]);
    const update = (ops: Op[], qid: string) =>
      ops.find((o) => o.op === "addClaims" && "id" in o.target && o.target.id === qid);

    it("go on the new composition, cited to the work", () => {
      const comp = find(buildPlan(withWriters()).ops, "comp:0:2");
      expect(writersOf(comp)).toEqual([
        ["P86", "Q52583"],
        ["P86", "Q7146018"],
        ["P676", "Q52583"],
      ]);
      expect(comp?.claims.find((c) => c.property === "P86")?.references).toEqual([
        [
          { property: "P248", value: { type: "item", id: "Q14005" } },
          { property: "P435", value: { type: "string", value: WORK } },
          {
            property: "P813",
            value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
          },
        ],
      ]);
      // Not the track.
      expect(writersOf(find(buildPlan(withWriters()).ops, "track:0:2"))).toEqual([]);
    });

    it("leave out a writer with no QID, without holding up the run", () => {
      const state = withWriters();
      delete state.artists["Patrik Berger"];
      const plan = buildPlan(state);
      expect(plan.ready).toBe(true);
      expect(writersOf(find(plan.ops, "comp:0:2"))).toEqual([
        ["P86", "Q52583"],
        ["P676", "Q52583"],
      ]);
    });

    it("hold up the run for a writer whose QID isn't one", () => {
      const state = withWriters();
      state.artists["Patrik Berger"] = "Berger";
      const plan = buildPlan(state);
      expect(plan.ready).toBe(false);
      expect(plan.messages).toContainEqual([
        "err",
        "Composer or lyricist QID isn't valid for: Patrik Berger.",
      ]);
      expect(plan.blockers).toContain("performers");
    });

    it("aren't added with the setting off", () => {
      const state = withWriters();
      state.settings.mbWriters = false;
      state.artists["Patrik Berger"] = "Berger";
      const plan = buildPlan(state);
      expect(plan.ready).toBe(true);
      expect(writersOf(find(plan.ops, "comp:0:2"))).toEqual([]);
    });

    it("go on a reused composition only with Link reused items on", () => {
      const state = withWriters();
      state.discs[0].comp[2] = "Q102";
      expect(writersOf(update(buildPlan(state).ops, "Q102"))).toEqual([
        ["P86", "Q52583"],
        ["P86", "Q7146018"],
        ["P676", "Q52583"],
      ]);
      state.settings.extendExisting = false;
      expect(update(buildPlan(state).ops, "Q102")).toBeUndefined();
    });

    it("go uncited without the work they came from", () => {
      const state = withWriters();
      delete state.discs[0].tracks[1].mb!.source!.work;
      const comp = find(buildPlan(state).ops, "comp:0:2");
      expect(comp?.claims.find((c) => c.property === "P86")).not.toHaveProperty("references");
    });
  });

  describe("album details from a MusicBrainz import", () => {
    const RG = "b012a117-afa3-4ea3-879f-eeb61b974b0a";
    const REL = "6d42c8a3-69c3-458c-9f18-f8a503780607";
    const refTo = (property: string, value: string) => [
      [
        { property: "P248", value: { type: "item", id: "Q14005" } },
        { property, value: { type: "string", value } },
        {
          property: "P813",
          value: { type: "time", time: "+2026-10-04T00:00:00Z", precision: 11 },
        },
      ],
    ];
    const imported = () => {
      const state = structuredClone(EXAMPLE);
      state.album = {
        ...state.album,
        mode: "create",
        ids: {
          spotify: "4aawyAB9vmqN3uQ7FjRGTy",
          musicbrainz: RG,
          appleMusic: "",
          deezer: "",
          tidal: "",
          allmusic: "",
          discogs: "4348311",
        },
        mb: {
          releaseGroup: RG,
          release: REL,
          releaseGroupName: "Day and Night",
          retrieved: "2026-10-04",
          date: { value: "2026-09-18", from: "releaseGroup" },
          ids: {
            spotify: { value: "4aawyAB9vmqN3uQ7FjRGTy", from: "release" },
            discogs: { value: "4348311", from: "releaseGroup" },
          },
        },
      };
      return state;
    };
    const refsOf = (state: typeof EXAMPLE) => {
      const op = find(buildPlan(state).ops, "album");
      return Object.fromEntries(
        (op?.op === "create" ? op.claims : [])
          .filter((c) => ["P577", "P436", "P2205", "P1954"].includes(c.property))
          .map((c) => [c.property, c.references]),
      );
    };

    it("cite the release group or release each came from", () => {
      expect(refsOf(imported())).toEqual({
        P577: refTo("P436", RG),
        P436: undefined,
        P2205: refTo("P5813", REL),
        P1954: refTo("P436", RG),
      });
    });

    it("lose the reference once edited", () => {
      const edited = imported();
      edited.settings.date = "2026-09";
      edited.album.ids.spotify = "4aawyAB9vmqN3uQ7FjRGTz";
      expect(refsOf(edited)).toMatchObject({ P577: undefined, P2205: undefined });
      expect(refsOf(edited).P1954).toEqual(refTo("P436", RG));
    });

    it("name the release group ID as the release group is on MusicBrainz", () => {
      const p436 = (state: typeof EXAMPLE) => {
        const op = find(buildPlan(state).ops, "album");
        return op?.op === "create" ? op.claims.find((c) => c.property === "P436") : undefined;
      };
      expect(p436(imported())?.qualifiers).toEqual([
        { property: "P1810", value: { type: "string", value: "Day and Night" } },
      ]);
      const changed = imported();
      changed.album.ids.musicbrainz = "f5093c06-23e3-404f-aeaa-40f72885ee3a";
      expect(p436(changed)).not.toHaveProperty("qualifiers");
    });

    it("lose the reference once the album's release group is changed", () => {
      const state = imported();
      state.album.ids.musicbrainz = "f5093c06-23e3-404f-aeaa-40f72885ee3a";
      expect(Object.values(refsOf(state)).every((r) => r === undefined)).toBe(true);
    });

    it("keep the reference with the same release group written another way", () => {
      const state = imported();
      const spotify = state.album.mb!.ids.spotify;
      for (const rg of [RG.toUpperCase(), `https://musicbrainz.org/release-group/${RG}`]) {
        state.album.ids.musicbrainz = rg;
        expect(citesMb(state, spotify, "4aawyAB9vmqN3uQ7FjRGTy")).toBe(true);
      }
    });

    it("say the date gets a reference only when it does", () => {
      const state = imported();
      expect(citesMbDate(state)).toBe(true);
      state.album.mb!.date = { value: "2026-02-30", from: "releaseGroup" };
      state.settings.date = "2026-02-30";
      expect(citesMbDate(state)).toBe(false);
      expect(refsOf(state).P577).toBeUndefined();
    });

    it("keep the reference on a date with spaces around it", () => {
      const state = imported();
      state.settings.date = " 2026-09-18 ";
      expect(refsOf(state).P577).toEqual(refTo("P436", RG));
    });
  });

  it("needs a single's own release date or an existing single, not both", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].single["2"] = { date: "", qid: "", discogs: "" };
    expect(buildPlan(state).singleErrs["0:2"]).toMatch(/Enter the new single's release date/);
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "Q30", discogs: "" };
    expect(buildPlan(state).singleErrs["0:2"]).toMatch(/not both/);
    state.discs[0].single["2"] = { date: "", qid: "Q30", discogs: "" };
    expect(buildPlan(state).singleErrs).toEqual({});
  });

  it("gives an existing single the track's title only if it has none", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].single["2"] = { date: "", qid: "Q30", discogs: "" };
    const op = buildPlan(state).ops.find(
      (o) => o.op === "addClaims" && o.what.startsWith("single"),
    );
    const titles = op?.claims.filter((c) => c.property === "P1476");
    expect(titles).toHaveLength(1);
    expect(titles![0].ifMissing).toBe(true);
    expect(titles![0].value).toMatchObject({
      type: "monolingual",
      text: "Habits of Creatures",
    });
  });

  it("gives a single one track, an existing one only if it has no count", () => {
    const P2635 = {
      property: "P2635",
      value: { type: "quantity", amount: 1, unit: "Q7302866" },
    };
    const state = structuredClone(EXAMPLE);
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "", discogs: "" };
    state.discs[0].single["3"] = { date: "", qid: "Q30", discogs: "" };
    const { ops } = buildPlan(state);
    const made = find(ops, "single:0:2");
    expect(made?.op === "create" && made.claims).toContainEqual(P2635);
    const reused = ops.find((o) => o.op === "addClaims" && o.what.startsWith("single"));
    expect(reused?.claims).toContainEqual({ ...P2635, ifMissing: true });
  });

  describe("a single's Discogs master ID", () => {
    const P1954 = { property: "P1954", value: { type: "string", value: "4348311" } };
    const withSingle = (sg: { date?: string; qid?: string; discogs?: string }) => {
      const state = structuredClone(EXAMPLE);
      state.discs[0].single["2"] = { date: "", qid: "", discogs: "", ...sg };
      return buildPlan(state);
    };
    const reused = (ops: Op[]) =>
      ops.find((o) => o.op === "addClaims" && o.what.startsWith("single"));
    const claimsOf = (o: Op | undefined) => o?.claims ?? [];

    it("goes on a new single", () => {
      const plan = withSingle({ date: "2026-05-01", discogs: "4348311" });
      expect(plan.ready).toBe(true);
      expect(claimsOf(find(plan.ops, "single:0:2"))).toContainEqual(P1954);
    });

    it("goes on an existing single only if it has none", () => {
      const plan = withSingle({ qid: "Q30", discogs: "4348311" });
      expect(plan.ready).toBe(true);
      expect(claimsOf(reused(plan.ops))).toContainEqual({ ...P1954, ifMissing: true });
    });

    it("is left out when blank", () => {
      for (const sg of [{ date: "2026-05-01" }, { qid: "Q30" }]) {
        const plan = withSingle({ ...sg, discogs: " " });
        expect(plan.singleErrs).toEqual({});
        const op = sg.qid ? reused(plan.ops) : find(plan.ops, "single:0:2");
        expect(op).toBeDefined();
        expect(claimsOf(op).some((c) => c.property === "P1954")).toBe(false);
      }
    });

    it("blocks the run when it isn't an ID", () => {
      for (const sg of [{ date: "2026-05-01" }, { qid: "Q30" }]) {
        const plan = withSingle({ ...sg, discogs: "abc" });
        expect(plan.singleErrs["0:2"]).toMatch(/doesn't look like a Discogs master ID/);
        expect(plan.ready).toBe(false);
      }
    });
  });

  it("links created items by reference", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "", discogs: "" };
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

  it("labels a new track, composition, single and album under mul as well", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "", discogs: "" };
    const { ops } = buildPlan(state);
    const terms = (key: string) => {
      const o = find(ops, key);
      return o?.op === "create" && { labels: o.labels, descLangs: Object.keys(o.descriptions) };
    };
    for (const key of ["track:0:2", "comp:0:2", "single:0:2"])
      expect(terms(key)).toEqual({
        labels: { en: "Habits of Creatures", mul: "Habits of Creatures" },
        descLangs: ["en"],
      });
    const album = terms("album");
    expect(album && Object.keys(album.labels)).toEqual(["en", "mul"]);
    expect(album && album.descLangs).toEqual(["en"]);
  });

  it("labels new items once when the run's language is mul", () => {
    const state = { ...structuredClone(EXAMPLE), settings: { ...EXAMPLE.settings, lang: "mul" } };
    state.album.mode = "create";
    state.discs[0].single["2"] = { date: "2026-05-01", qid: "", discogs: "" };
    const { ops } = buildPlan(state);
    for (const key of ["track:0:2", "comp:0:2", "single:0:2", "album"]) {
      const o = find(ops, key);
      expect(o?.op === "create" && Object.keys(o.labels)).toEqual(["mul"]);
      expect(o?.op === "create" && o.descriptions).toEqual({});
    }
  });

  it("writes a $ in an artist's name as it is", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].tracks[0].artists = ["Joey Bada$$"];
    state.discs[0].tracks[1].artists = ["A$'B"];
    state.artists = { ...state.artists, "Joey Bada$$": "Q1", "A$'B": "Q2" };
    const { ops } = buildPlan(state);
    const desc = (key: string) => {
      const o = find(ops, key);
      return o?.op === "create" ? o.descriptions.en : undefined;
    };
    expect(desc("track:0:1")).toContain("Joey Bada$$");
    expect(desc("track:0:2")).toContain("A$'B");
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

  describe("rows entered by hand", () => {
    const errsOf = (edit: (state: typeof EXAMPLE) => void) => {
      const state = structuredClone(EXAMPLE);
      edit(state);
      return buildPlan(state);
    };

    it("marks each problem in its cell, with one message for the run", () => {
      const plan = errsOf((s) => {
        const [first, second] = s.discs[0].tracks;
        first.title = "  ";
        first.length = "3:2";
        second.artists = [];
        s.discs[0].comp[2] = "Q12x";
      });
      expect(plan.rowErrs).toEqual({
        "0:1": { title: "Enter the title.", length: "Use m:ss" },
        "0:2": { artists: "Enter the artists.", comp: '"Q12x" isn\'t a QID.' },
      });
      expect(plan.messages.filter((m) => m[0] === "err").map((m) => m[1])).toEqual([
        "2 tracks have errors. They're marked in the track table.",
      ]);
      expect(plan.blockers).toEqual(["tracks"]);
    });

    it("uses a typed length in place of the imported one, and none when it's blank", () => {
      const plan = errsOf((s) => {
        s.discs[0].tracks[0].length = "1:02:03";
        s.discs[0].tracks[1].length = "";
      });
      expect(plan.tracks[0][0].seconds).toBe(3723);
      expect(plan.tracks[0][1].seconds).toBeNull();
      expect(plan.rowErrs).toEqual({});
    });

    it("gives a row with no artists the new album's", () => {
      const plan = errsOf((s) => {
        s.album = {
          ...s.album,
          mode: "create",
          title: "Day and Night",
          artists: ["Carly Rae Jepsen"],
        };
        s.discs[0].tracks[0].artists = [];
      });
      expect(plan.tracks[0][0].artists).toEqual(["Carly Rae Jepsen"]);
      expect(plan.rowErrs).toEqual({});
      expect(plan.ready).toBe(true);
    });
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

    it("marks an over-long track title in its cell", () => {
      const state = structuredClone(EXAMPLE);
      const long = "x".repeat(MAX_TERM_LENGTH + 10);
      state.discs = [{ ...emptyDisc(), tracks: [track(1, long, "3:00")] }];
      const plan = buildPlan(state);
      expect(plan.rowErrs["0:1"]).toEqual({
        title: `Wikidata allows ${MAX_TERM_LENGTH} characters at most. This title has ${MAX_TERM_LENGTH + 10}.`,
      });
      expect(errors(plan)).toEqual(["1 track has errors. They're marked in the track table."]);
    });

    it("names each over-long filled-in description once", () => {
      const state = structuredClone(EXAMPLE);
      state.discs = [{ ...emptyDisc(), tracks: [track(1, "Song", "3:00")] }];
      state.settings.trackDesc = `${"y".repeat(MAX_TERM_LENGTH)} by {artists}`;
      const plan = buildPlan(state);
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        `Wikidata allows ${MAX_TERM_LENGTH} characters at most in a label or description. ` +
          `Too long: the track description for track 1.1 (${MAX_TERM_LENGTH + 20}).`,
      ]);
    });
  });

  describe("discs' parts", () => {
    const errors = (plan: ReturnType<typeof buildPlan>) =>
      plan.messages.filter((m) => m[0] === "err").map((m) => m[1]);
    const withParts = (...parts: string[]) => {
      const state = structuredClone(EXAMPLE);
      parts.forEach((p, di) => void (state.discs[di].part = p));
      return state;
    };

    it("block several discs without parts", () => {
      const plan = buildPlan(withParts("", ""));
      expect(plan.ready).toBe(false);
      expect(plan.ops).toEqual([]);
      expect(plan.blockers).toContain("tracks");
      expect(errors(plan)).toEqual([
        "Discs 1 and 2 have no part. A release with several discs needs a part on each, " +
          "e.g. CD1 and CD2, so their track numbers can be told apart.",
      ]);
      expect(plan.fieldErrs["part-0"]).toBe(
        "Choose this disc's part. Each disc needs one when there are several.",
      );
      expect(plan.fieldErrs["part-1"]).toBe(plan.fieldErrs["part-0"]);
    });

    it("block a disc without a part among discs with them", () => {
      const plan = buildPlan(withParts("Q61629664", ""));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        "Disc 2 has no part. A release with several discs needs a part on each, " +
          "e.g. CD1 and CD2, so their track numbers can be told apart.",
      ]);
      expect(plan.fieldErrs["part-0"]).toBe("");
    });

    it("block two discs with the same part", () => {
      const plan = buildPlan(withParts("Q61629664", "Q61629664"));
      expect(plan.ready).toBe(false);
      expect(errors(plan)).toEqual([
        "Discs 1 and 2 have the same part, CD1. Give each disc its own part.",
      ]);
      expect(plan.fieldErrs["part-0"]).toBe("Disc 2 has this part too. Each disc needs its own.");
      expect(plan.fieldErrs["part-1"]).toBe("Disc 1 has this part too. Each disc needs its own.");
    });

    it("don't need a part on a lone disc, or on a disc without tracks", () => {
      const lone = withParts("");
      lone.discs = [lone.discs[0]];
      expect(buildPlan(lone).ready).toBe(true);
      const empty = withParts("", "");
      empty.discs[1].tracks = [];
      expect(buildPlan(empty).ready).toBe(true);
    });

    it("tell the discs apart in the tracklist", () => {
      const op = buildPlan(EXAMPLE).ops.at(-1) as Extract<Op, { op: "addClaims" }>;
      const parts = op.claims
        .filter((c) => c.property === "P658")
        .map((c) => c.qualifiers?.find((q) => q.property === "P518")?.value);
      expect(new Set(parts.map((v) => JSON.stringify(v))).size).toBe(2);
      expect(parts).not.toContain(undefined);
    });
  });

  describe("size limits", () => {
    const tracklist = (count: number) =>
      Array.from({ length: count }, (_, i) => track(i + 1, `Song ${i + 1}`, "3:00"));
    const withDiscs = (...counts: number[]) => {
      const state = structuredClone(EXAMPLE);
      state.discs = counts.map((n, i) => ({
        ...emptyDisc(),
        part: PARTS[0][1][i][0],
        tracks: tracklist(n),
      }));
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

describe("descTypeLabel", () => {
  it("uses the form's label for an album", () => {
    expect(descTypeLabel("Q482994", "Q208569")).toBe("studio album");
    expect(descTypeLabel("Q482994", "Q209939")).toBe("live album");
    expect(descTypeLabel("Q482994", "")).toBe("album");
  });

  it("says EP for an EP, whatever its form", () => {
    expect(descTypeLabel("Q169930", "")).toBe("EP");
    expect(descTypeLabel("Q169930", "Q208569")).toBe("EP");
    expect(descTypeLabel("Q169930", "Q209939")).toBe("live EP");
    expect(descTypeLabel("Q169930", "Q963099")).toBe("remix EP");
  });
});

describe("albumDescPreview", () => {
  const album = (more: Partial<typeof EXAMPLE.album> = {}) => {
    const state = structuredClone(EXAMPLE);
    Object.assign(state.album, { mode: "create", title: "Day and Night" }, more);
    return state;
  };

  it("fills in the year, form and artists", () => {
    expect(albumDescPreview(album({ artists: ["Carly Rae Jepsen", "Ghost"] }))).toBe(
      "2026 studio album by Carly Rae Jepsen and Ghost",
    );
  });

  it("leaves what it can't fill as written", () => {
    const state = album({ artists: [], type: "Q169930", form: "" });
    state.settings.date = "";
    expect(albumDescPreview(state)).toBe("{year} EP by {artists}");
  });
});

describe("descPreviews", () => {
  const previews = (state: typeof EXAMPLE) => descPreviews(state, buildPlan(state));

  it("fills in the templates for the first track", () => {
    expect(previews(EXAMPLE)).toEqual({
      comp: "2026 song by Carly Rae Jepsen",
      track: "vocal track by Carly Rae Jepsen",
      single: null,
    });
  });

  it("takes a single's year from its release date", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].single = { "3": { date: "2025-05-02", qid: "", discogs: "" } };
    expect(previews(state)?.single).toBe("2025 single by Carly Rae Jepsen");
  });

  it("leaves {year} as written without a publication date", () => {
    const state = structuredClone(EXAMPLE);
    state.settings.date = "";
    expect(previews(state)?.comp).toBe("{year} song by Carly Rae Jepsen");
  });

  it("waits for a track or album artist", () => {
    expect(previews(EMPTY)).toBeNull();
  });
});

describe("describeOp", () => {
  // The example's album exists, so its tracklist edit also has the number of
  // tracks, only for when the album doesn't say already.
  const tracklist = buildPlan(EXAMPLE).ops.find(
    (o) => o.op === "addClaims" && o.what === "album tracklist",
  )!;

  it("counts every statement planned", () => {
    expect(describeOp(tracklist)).toBe("Add 26 statements to album tracklist");
  });

  it("counts only the ones sent, for an edit summary", () => {
    expect(describeOp(tracklist, 24)).toBe("Add 24 statements to album tracklist");
    expect(describeOp(tracklist, 1)).toBe("Add 1 statement to album tracklist");
  });
});
