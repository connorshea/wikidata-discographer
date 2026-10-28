import { describe, expect, it } from "vite-plus/test";
import { EXAMPLE } from "./example.fixture.ts";
import { buildPlan, type State } from "./plan.ts";
import {
  createCounts,
  performerRows,
  type ProgressInput,
  railSteps,
  runChecks,
  settingsPills,
  startSummary,
} from "./progress.ts";
import { EMPTY } from "./state.ts";

const input = (state: State, more: Partial<ProgressInput> = {}): ProgressInput => ({
  state,
  plan: buildPlan(state),
  unreviewed: 0,
  hasTracklist: false,
  notAlbum: false,
  running: null,
  ...more,
});

const checks = (p: ProgressInput) =>
  runChecks({ ...p, ineligible: null, matchesPending: false, albumPending: false });

describe("buildPlan blockers", () => {
  it("names a section for each error", () => {
    const plan = buildPlan(EMPTY);
    expect(plan.blockers.length).toBe(plan.messages.filter(([k]) => k === "err").length);
    expect(plan.blockers).toContain("tracks");
  });
});

describe("railSteps", () => {
  it("leaves every step to do on an empty form", () => {
    const steps = railSteps(input(EMPTY));
    expect(steps.map((s) => s.status)).toEqual(Array(6).fill("pending"));
    expect(steps[0]).toMatchObject({ name: "Start", summary: "Pick a starting point" });
    expect(steps[5].summary).toBe("Nothing to create yet");
  });

  it("locks the steps after Start until a starting point is picked", () => {
    expect(railSteps(input(EMPTY)).map((s) => s.locked)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(railSteps(input(EXAMPLE)).some((s) => s.locked)).toBe(false);
  });

  it("sums up a filled-in form", () => {
    const steps = railSteps(input(EXAMPLE));
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.album.summary).toBe(`Existing · ${EXAMPLE.album.qid}`);
    expect(byId.tracks.summary).toBe("2 discs · 24 tracks");
    expect(byId.performers).toMatchObject({ summary: "1 of 1 performer linked", status: "done" });
    expect(byId.create.summary).toMatch(/^Ready · \d+ edits$/);
  });

  it("flags unreviewed matches and unlinked performers", () => {
    const state = structuredClone(EXAMPLE);
    state.artists = {};
    const byId = Object.fromEntries(
      railSteps(input(state, { unreviewed: 2 })).map((s) => [s.id, s]),
    );
    expect(byId.tracks).toMatchObject({ status: "attention" });
    expect(byId.tracks.summary).toContain("2 to review");
    expect(byId.performers).toMatchObject({
      summary: "0 of 1 performer linked",
      status: "attention",
    });
    expect(byId.create.summary).toBe("Blocked: 1 performer");
  });

  it("flags an existing album QID that isn't an album or EP", () => {
    const p = input(EXAMPLE, { notAlbum: true });
    const byId = Object.fromEntries(railSteps(p).map((s) => [s.id, s]));
    expect(byId.album).toMatchObject({ status: "attention" });
    expect(byId.create.summary).toBe("Blocked: album QID");
    expect(checks(p).find((c) => c.at === "album")).toMatchObject({ ok: false });
  });

  it("locks the later steps until a starting point is picked", () => {
    const steps = railSteps(input({ ...EXAMPLE, start: null }, { unreviewed: 2 }));
    expect(steps.map((s) => s.status)).toEqual(Array(6).fill("pending"));
    expect(steps[0].summary).toBe("Pick a starting point");
    expect(steps[5].summary).toBe("Blocked: pick a starting point");
    expect(railSteps(input(EXAMPLE))[0]).toMatchObject({ name: "Source", summary: "Album QID" });
  });

  it("shows a run's progress", () => {
    const steps = railSteps(input(EXAMPLE, { running: { done: 3, total: 49 } }));
    expect(steps[5].summary).toBe("Running · 3 of 49");
  });
});

describe("startSummary", () => {
  it("sums up an existing album by its label", () => {
    expect(startSummary(EXAMPLE, buildPlan(EXAMPLE), "Day and Night")).toEqual({
      from: "Started from an album QID",
      title: "Day and Night",
      details: ["Carly Rae Jepsen", "2 discs", "24 tracks"],
    });
    expect(startSummary(EXAMPLE, buildPlan(EXAMPLE), null)?.title).toBe(EXAMPLE.album.qid);
  });

  it("says when an import's album will be created", () => {
    const state: State = { ...EXAMPLE, start: "mb", album: { ...EXAMPLE.album, mode: "create" } };
    expect(startSummary(state, buildPlan(state), null)?.details).toContain(
      "not on Wikidata yet, so a new album will be created",
    );
  });

  it("calls a new single a single", () => {
    const state: State = {
      ...EXAMPLE,
      start: "new",
      album: { ...EXAMPLE.album, mode: "create", title: "", type: "Q134556", form: "" },
    };
    expect(startSummary(state, buildPlan(state), null)).toMatchObject({
      from: "New single from scratch",
      title: "Untitled single",
    });
    const mb: State = { ...state, start: "mb" };
    expect(startSummary(mb, buildPlan(mb), null)?.details).toContain(
      "not on Wikidata yet, so a new single will be created",
    );
  });

  it("has nothing to say before a starting point is picked", () => {
    expect(startSummary(EMPTY, buildPlan(EMPTY), null)).toBeNull();
  });
});

describe("createCounts", () => {
  it("counts from the form while the plan is blocked", () => {
    const state = structuredClone(EXAMPLE);
    state.artists = {};
    const counts = createCounts(state, buildPlan(state));
    expect(counts.find((c) => c.kind === "tracks")?.count).toBe(24);
  });

  it("counts a composition for a reused track whether or not the plan is blocked", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].track[2] = "Q999";
    const comps = (s: typeof state) =>
      createCounts(s, buildPlan(s)).find((c) => c.kind === "compositions")?.count;
    const ready = comps(state);
    state.artists = {};
    expect(comps(state)).toBe(ready);
  });
});

describe("runChecks", () => {
  it("links each unmet check to its section", () => {
    const list = checks(input({ ...EMPTY, start: "new" }));
    expect(list.filter((c) => !c.ok).map((c) => c.at)).toEqual(
      expect.arrayContaining(["album", "tracks", "performers"]),
    );
  });

  it("asks for a starting point first", () => {
    const list = checks(input({ ...EXAMPLE, start: null }));
    expect(list.find((c) => !c.ok)).toMatchObject({ text: "Pick a starting point", at: "start" });
  });

  it("passes a ready form", () => {
    expect(checks(input(EXAMPLE)).every((c) => c.ok)).toBe(true);
  });

  it("waits on the existing album's lookup", () => {
    const list = runChecks({
      ...input(EXAMPLE),
      ineligible: null,
      matchesPending: false,
      albumPending: true,
    });
    expect(list.find((c) => c.at === "album")).toMatchObject({
      ok: false,
      text: "Checking the album on Wikidata…",
    });
  });

  it("leaves an empty form's checks to do, with no problems", () => {
    const list = runChecks({
      ...input(EMPTY),
      ineligible: null,
      matchesPending: false,
      albumPending: false,
    });
    expect(list.every((c) => !c.ok && !c.problem)).toBe(true);
  });

  it("lists an account that can't edit yet as a problem, and nothing about logging in", () => {
    expect(checks(input(EXAMPLE)).map((c) => c.text)).not.toContain(
      "Logged in and eligible to edit",
    );
    const list = runChecks({
      ...input(EXAMPLE),
      ineligible: "Your account is too new to edit",
      matchesPending: false,
      albumPending: false,
    });
    expect(list[0]).toMatchObject({
      ok: false,
      problem: true,
      text: "Your account is too new to edit",
    });
  });

  it("marks an unlinked performer as a problem once there are tracks", () => {
    const state = structuredClone(EXAMPLE);
    state.artists = {};
    const c = checks(input(state)).find((x) => x.at === "performers");
    expect(c).toMatchObject({ ok: false, problem: true });
  });

  it("asks for matches to be reviewed", () => {
    const c = checks(input(EXAMPLE, { unreviewed: 2 })).find((x) => x.at === "matches");
    expect(c?.text).toBe("Review 2 possible matches");
  });
});

describe("settingsPills", () => {
  it("sums up the settings", () => {
    expect(settingsPills(EXAMPLE.settings)).toEqual([
      "Labels: English",
      "Language of work: English (Q1860)",
      "Published 2026-09-18",
      "3 options on",
    ]);
  });

  it("names what's missing", () => {
    const S = { ...EMPTY.settings, lang: "nds", straight: false };
    expect(settingsPills(S)).toEqual(["Labels: nds", "No publication date", "2 options on"]);
  });
});

describe("performerRows", () => {
  const performer = { performer: true, composer: false, lyricist: false, songs: [] };
  it("lists each name's tracks and marks the album artists", () => {
    const state = structuredClone(EXAMPLE);
    state.discs[0].tracks[1].artists = ["Carly Rae Jepsen", "Guest"];
    const rows = performerRows(state, buildPlan(state));
    expect(rows.map((r) => ({ ...r, tracks: r.tracks.length }))).toEqual([
      { name: "Carly Rae Jepsen", tracks: 24, albumArtist: false, ...performer },
      { name: "Guest", tracks: 1, albumArtist: false, ...performer },
    ]);
    expect(rows[1].tracks).toEqual([
      { disc: 0, row: 1, n: 2, title: state.discs[0].tracks[1].title },
    ]);
    state.start = "mb";
    expect(performerRows(state, buildPlan(state))[0].albumArtist).toBe(true);
  });

  it("lists the composers and lyricists after the performers", () => {
    const state = structuredClone(EXAMPLE);
    const writer = (id: string, name: string) => ({ id, name });
    const crj = writer("09887aa7-226e-4ecc-9a0c-02d2ae5777e1", "Carly Rae Jepsen");
    const berger = writer("ffadf26a-2593-4eaf-8c5d-a54cbc5aedc5", "Patrik Berger");
    state.discs[0].tracks.slice(0, 2).forEach((t, i) => {
      t.mb = {
        recording: "",
        work: "",
        recordingName: "",
        workName: "",
        iswcs: [],
        isrcs: [],
        spotify: [],
        appleMusic: [],
        deezer: [],
        tidal: [],
        composers: i ? [crj] : [crj, berger],
        lyricists: [crj],
        source: null,
      };
    });
    const rows = () => performerRows(state, buildPlan(state));
    const at = (row: number) => ({
      disc: 0,
      row,
      n: row + 1,
      title: state.discs[0].tracks[row].title,
    });
    expect(rows().map((r) => ({ ...r, tracks: r.tracks.length }))).toEqual([
      {
        name: "Carly Rae Jepsen",
        tracks: 24,
        albumArtist: false,
        ...performer,
        composer: true,
        lyricist: true,
        songs: [at(0), at(1)],
      },
      {
        name: "Patrik Berger",
        tracks: 0,
        albumArtist: false,
        performer: false,
        composer: true,
        lyricist: false,
        songs: [at(0)],
      },
    ]);
    state.settings.mbWriters = false;
    state.discs[0].comp = {};
    expect(rows().map((r) => r.name)).toEqual(["Carly Rae Jepsen"]);
  });
});
