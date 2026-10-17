import { describe, expect, it } from "vite-plus/test";
import { EXAMPLE } from "./example.fixture.ts";
import { buildPlan, type State } from "./plan.ts";
import { createCounts, type ProgressInput, railSteps, runChecks } from "./progress.ts";
import { EMPTY } from "./state.ts";

const input = (state: State, more: Partial<ProgressInput> = {}): ProgressInput => ({
  state,
  plan: buildPlan(state),
  empty: false,
  unreviewed: 0,
  hasTracklist: false,
  running: null,
  ...more,
});

const checks = (p: ProgressInput) =>
  runChecks({ ...p, loggedIn: true, ineligible: null, matchesPending: false });

describe("buildPlan blockers", () => {
  it("names a section for each error", () => {
    const plan = buildPlan(EMPTY);
    expect(plan.blockers.length).toBe(plan.messages.filter(([k]) => k === "err").length);
    expect(plan.blockers).toContain("tracks");
  });
});

describe("railSteps", () => {
  it("leaves every step to do on an empty form", () => {
    const steps = railSteps(input(EMPTY, { empty: true }));
    expect(steps.map((s) => s.status)).toEqual(Array(6).fill("pending"));
    expect(steps[0]).toMatchObject({ name: "Start", summary: "Pick a starting point" });
    expect(steps[5].summary).toBe("Nothing to create yet");
  });

  it("sums up a filled-in form", () => {
    const steps = railSteps(input(EXAMPLE));
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.album.summary).toBe(`Existing · ${EXAMPLE.album.qid}`);
    expect(byId.tracks.summary).toBe("2 discs · 24 tracks");
    expect(byId.performers).toMatchObject({ summary: "1 of 1 linked", status: "done" });
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
    expect(byId.performers).toMatchObject({ summary: "0 of 1 linked", status: "attention" });
    expect(byId.create.summary).toBe("Blocked: 1 performer");
  });

  it("shows a run's progress", () => {
    const steps = railSteps(input(EXAMPLE, { running: { done: 3, total: 49 } }));
    expect(steps[5].summary).toBe("Running · 3 of 49");
  });
});

describe("createCounts", () => {
  it("counts from the form while the plan is blocked", () => {
    const state = structuredClone(EXAMPLE);
    state.artists = {};
    const counts = createCounts(state, buildPlan(state));
    expect(counts.find((c) => c.kind === "tracks")?.count).toBe(24);
  });
});

describe("runChecks", () => {
  it("links each unmet check to its section", () => {
    const list = checks(input(EMPTY, { empty: true }));
    expect(list.filter((c) => !c.ok).map((c) => c.at)).toEqual(
      expect.arrayContaining(["album", "start", "performers"]),
    );
  });

  it("passes a ready form", () => {
    expect(checks(input(EXAMPLE)).every((c) => c.ok)).toBe(true);
  });

  it("asks for matches to be reviewed", () => {
    const c = checks(input(EXAMPLE, { unreviewed: 2 })).find((x) => x.at === "matches");
    expect(c?.text).toBe("Review 2 possible matches");
  });
});
