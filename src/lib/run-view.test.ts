import { describe, expect, it } from "vite-plus/test";
import type { SubmissionInfo } from "./api-types.ts";
import { EXAMPLE } from "./example.fixture.ts";
import { buildPlan, describeOp } from "./plan.ts";
import {
  editShares,
  entryKind,
  roughly,
  runEdits,
  runProgress,
  startedAt,
  timeLeft,
} from "./run-view.ts";

const plan = buildPlan(EXAMPLE);
const edits = runEdits(plan, EXAMPLE);

/** A run of the example form with its first `done` edits made. */
function runOf(done: number, status: SubmissionInfo["status"] = "running"): SubmissionInfo {
  return {
    id: 1,
    status,
    title: "Q140316456",
    albumQid: "Q140316456",
    editGroupUrl: "https://editgroups.toolforge.org/b/OR/x/",
    error: null,
    createdAt: "2026-10-17 10:00:00",
    finishedAt: null,
    total: plan.ops.length,
    waitingUntil: null,
    edits: plan.ops.slice(0, done).map((op) => ({
      op: op.op,
      key: op.op === "create" ? op.key : null,
      kind: op.op === "create" ? op.kind : null,
      what: describeOp(op),
      qid: "Q1",
      revid: 1,
      ok: true,
      unknown: false,
      skipped: 0,
      error: null,
    })),
    input: EXAMPLE,
  };
}

describe("runEdits", () => {
  it("lists the plan's edits in run order", () => {
    expect(edits.map((e) => e.n)).toEqual(plan.ops.map((_, i) => i + 1));
  });
});

describe("editShares", () => {
  it("splits the edits by item type, with what's reused", () => {
    const shares = editShares(edits, "Day and Night");
    expect(shares.map((s) => [s.kind, s.edits, s.count, s.text, s.extra])).toEqual([
      ["comp", 24, 23, "new compositions", "1 reused"],
      ["track", 24, 24, "new tracks", null],
      ["album", 1, 1, "tracklist added to Day and Night", null],
    ]);
    expect(shares.reduce((n, s) => n + s.edits, 0)).toBe(plan.ops.length);
  });

  it("says a new album is made with its tracklist", () => {
    const state = structuredClone(EXAMPLE);
    state.album.mode = "create";
    const album = editShares(runEdits(buildPlan(state), state), "Day and Night").find(
      (s) => s.kind === "album",
    );
    expect(album).toMatchObject({ edits: 2, count: 1, text: "new album with its tracklist" });
  });
});

describe("runProgress", () => {
  it("counts each type's edits made so far, and names the next one", () => {
    const info = runProgress(runOf(30));
    expect(info.kinds.map((k) => [k.label, k.done, k.total])).toEqual([
      ["Compositions", 24, 24],
      ["Tracks", 6, 24],
      ["Album tracklist", 0, 1],
    ]);
    expect(info.next).toMatchObject({ kind: "track", creates: true, place: { disc: 1, n: 7 } });
    expect(info.secondsLeft).toBeGreaterThan(0);
  });

  it("has nothing next once the run has ended", () => {
    const info = runProgress(runOf(plan.ops.length, "done"));
    expect(info.next).toBeNull();
    expect(info.secondsLeft).toBe(0);
  });

  it("calls an existing single a single, from the form the run was sent", () => {
    const input = structuredClone(EXAMPLE);
    input.album.singleQid = input.album.qid;
    const info = runProgress({ ...runOf(plan.ops.length - 1), input });
    expect(info.kinds.at(-1)?.label).toBe("Single tracklist");
    expect(info.next).toMatchObject({ noun: "single", title: "Single tracklist" });
  });

  it("doesn't guess when the plan no longer lines up with the run", () => {
    const info = runProgress({ ...runOf(3), total: plan.ops.length + 1 });
    expect(info.edits).toBeNull();
    expect(info.kinds).toEqual([]);
    expect(info.next).toBeNull();
  });
});

describe("timeLeft", () => {
  it("rounds to what's worth saying", () => {
    expect(timeLeft(0)).toBe("Finishing up.");
    expect(timeLeft(20)).toBe("Less than a minute left.");
    expect(timeLeft(70)).toBe("About a minute left.");
    expect(timeLeft(200)).toBe("About 3 minutes left.");
  });
});

describe("entryKind", () => {
  it("reads the kind the server logged", () => {
    const e = runOf(1).edits[0];
    expect(entryKind({ ...e, kind: "work" })).toBe("comp");
    expect(entryKind({ ...e, kind: "track" })).toBe("track");
    expect(entryKind({ ...e, kind: null })).toBe("album");
  });
});

describe("startedAt", () => {
  it("leaves the date out for a run started today", () => {
    const at = startedAt("2026-10-17 10:00:00", new Date("2026-10-17T12:00:00Z"));
    expect(at).not.toContain("·");
    expect(startedAt("2026-10-01 10:00:00", new Date("2026-10-17T12:00:00Z"))).toContain(" · ");
  });
});

describe("roughly", () => {
  it("rounds to the minute, in lower case for the middle of a sentence", () => {
    expect(roughly(20)).toBe("less than a minute");
    expect(roughly(70)).toBe("about a minute");
    expect(roughly(200)).toBe("about 3 minutes");
  });
});
