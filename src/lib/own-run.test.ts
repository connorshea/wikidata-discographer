import { describe, expect, it } from "vite-plus/test";
import type { EditLogEntry } from "./api-types.ts";
import { FetchError } from "./client.ts";
import {
  applyCreated,
  createdAny,
  initialRunId,
  isGone,
  loadOwnRun,
  OWN_RUN_KEY,
  parseOwnRun,
  saveOwnRun,
  settleOwnRun,
} from "./own-run.ts";
import { EMPTY, emptyDisc } from "./state.ts";

/** A Storage backed by a Map. */
function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("saving the own run", () => {
  it("saves, loads and forgets it", () => {
    const store = memoryStore();
    expect(loadOwnRun(store)).toBeNull();
    saveOwnRun({ run: 7, form: "f1" }, store);
    expect(store.m.get(OWN_RUN_KEY)).toBe('{"run":7,"form":"f1"}');
    expect(loadOwnRun(store)).toEqual({ run: 7, form: "f1" });
    saveOwnRun(null, store);
    expect(store.m.has(OWN_RUN_KEY)).toBe(false);
  });

  it("ignores anything that isn't an own run, including a bare run id", () => {
    for (const raw of [
      null,
      "",
      "7",
      "null",
      "{",
      '{"run":7}',
      '{"run":0,"form":"f"}',
      '{"run":1.5,"form":"f"}',
      '{"run":"7","form":"f"}',
    ])
      expect(parseOwnRun(raw)).toBeNull();
  });

  it("carries on when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadOwnRun(blocked)).toBeNull();
    expect(() => saveOwnRun({ run: 1, form: "f" }, blocked)).not.toThrow();
    expect(() => saveOwnRun(null, blocked)).not.toThrow();
  });
});

describe("initialRunId", () => {
  it("shows the album list's run, else the own run", () => {
    const own = { run: 7, form: "f" };
    expect(initialRunId("?run=12", own)).toBe(12);
    expect(initialRunId("", own)).toBe(7);
    expect(initialRunId("?run=abc", own)).toBe(7);
    expect(initialRunId("?run=-3", null)).toBeNull();
    expect(initialRunId("", null)).toBeNull();
  });
});

describe("settleOwnRun", () => {
  const own = { run: 7, form: "f1" };

  it("keeps following a run still going, and ignores other runs", () => {
    expect(settleOwnRun({ id: 7, status: "running" }, own, "f1")).toBe("keep");
    expect(settleOwnRun({ id: 8, status: "done" }, own, "f1")).toBe("keep");
    expect(settleOwnRun({ id: 7, status: "done" }, null, "f1")).toBe("keep");
  });

  it("writes back once it ends, into the form it started from only", () => {
    for (const status of ["done", "failed", "interrupted", "unknown"] as const) {
      expect(settleOwnRun({ id: 7, status }, own, "f1")).toBe("apply");
      expect(settleOwnRun({ id: 7, status }, own, "f2")).toBe("drop");
    }
  });
});

describe("isGone", () => {
  it("is only a 404", () => {
    expect(isGone(new FetchError(404))).toBe(true);
    expect(isGone(new FetchError(401))).toBe(false);
    expect(isGone(new FetchError(503))).toBe(false);
    expect(isGone(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("applyCreated", () => {
  const edit = (e: Partial<EditLogEntry>): EditLogEntry => ({
    op: "create",
    key: null,
    kind: null,
    what: "",
    qid: null,
    revid: 1,
    ok: true,
    unknown: false,
    skipped: 0,
    error: null,
    ...e,
  });

  it("puts each created item in its field, by plan key", () => {
    const s = structuredClone(EMPTY);
    s.album = { ...s.album, mode: "create", title: "New" };
    s.discs = [emptyDisc(), emptyDisc()];
    s.discs[1].single[2] = { date: "2020-01-01", qid: "" };
    const edits = [
      edit({ key: "album", qid: "Q1" }),
      edit({ key: "comp:0:1", qid: "Q2" }),
      edit({ key: "track:0:1", qid: "Q3" }),
      edit({ key: "single:1:2", qid: "Q4" }),
    ];
    expect(createdAny(edits)).toBe(true);
    applyCreated(s, edits);
    expect(s.album).toMatchObject({ mode: "existing", qid: "Q1", title: "New" });
    expect(s.discs[0]).toMatchObject({ comp: { 1: "Q2" }, track: { 1: "Q3" } });
    // A reused single has no release date.
    expect(s.discs[1].single).toEqual({ 2: { date: "", qid: "Q4" } });
  });

  it("skips failures, unknowns not found, statement edits and missing discs", () => {
    const s = structuredClone(EMPTY);
    const edits = [
      edit({ key: "comp:0:1", qid: null, ok: false, unknown: true }),
      edit({ key: "comp:0:2", ok: false, error: "nope" }),
      edit({ op: "addClaims", qid: "Q5" }),
      edit({ key: "track:3:1", qid: "Q6" }),
    ];
    expect(createdAny(edits.slice(0, 3))).toBe(false);
    applyCreated(s, edits);
    expect(s).toEqual(EMPTY);
  });
});
