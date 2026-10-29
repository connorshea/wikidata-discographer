import { describe, expect, it } from "vite-plus/test";
import type { EditLogEntry } from "./api-types.ts";
import { FetchError } from "./client.ts";
import {
  adoptOwnRun,
  afterOwnRun,
  applyCreated,
  createdAny,
  formOfRun,
  initialRunId,
  isGone,
  loadOwnRun,
  OWN_RUN_KEY,
  parseOwnRun,
  saveOwnRun,
  settleOwnRun,
} from "./own-run.ts";
import { SINGLE_CLASS } from "./plan.ts";
import { EMPTY, emptyDisc } from "./state.ts";
import { track } from "./example.fixture.ts";
import { removeTrack } from "./tracks.ts";

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

describe("adoptOwnRun", () => {
  it("follows a run another tab starts, and keeps its own until it ends", () => {
    const mine = { run: 7, form: "f1" };
    expect(adoptOwnRun(null, '{"run":8,"form":"f1"}')).toEqual({ run: 8, form: "f1" });
    expect(adoptOwnRun(mine, '{"run":8,"form":"f1"}')).toEqual({ run: 8, form: "f1" });
    // The other tab settled it (or cleared storage): this tab settles it itself.
    expect(adoptOwnRun(mine, null)).toBe(mine);
    expect(adoptOwnRun(mine, "junk")).toBe(mine);
    expect(adoptOwnRun(null, null)).toBeNull();
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

describe("applyCreated", () => {
  it("puts each created item in its field, by plan key", () => {
    const s = structuredClone(EMPTY);
    s.album = { ...s.album, mode: "create", title: "New" };
    s.discs = [emptyDisc(), emptyDisc()];
    const edits = [
      edit({ key: "album", qid: "Q1" }),
      edit({ key: "comp:0:1", qid: "Q2" }),
      edit({ key: "track:0:1", qid: "Q3" }),
      edit({ key: "comp:1:2", qid: "Q4" }),
    ];
    expect(createdAny(edits)).toBe(true);
    applyCreated(s, edits);
    expect(s.album).toMatchObject({ mode: "existing", qid: "Q1", title: "New" });
    expect(s.discs[0]).toMatchObject({ comp: { 1: "Q2" }, track: { 1: "Q3" } });
    expect(s.discs[1].comp).toEqual({ 2: "Q4" });
  });

  it("records a new single as a single, as the lookup of it will", () => {
    const s = structuredClone(EMPTY);
    s.album = { ...s.album, mode: "create", type: SINGLE_CLASS };
    applyCreated(s, [edit({ key: "album", qid: "Q1" })]);
    expect(s.album).toMatchObject({ mode: "existing", qid: "Q1", singleQid: "Q1" });
  });

  it("leaves an album's singleQid empty", () => {
    const s = structuredClone(EMPTY);
    s.album = { ...s.album, mode: "create" };
    applyCreated(s, [edit({ key: "album", qid: "Q1" })]);
    expect(s.album.singleQid).toBe("");
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

describe("formOfRun", () => {
  const input = structuredClone(EMPTY);
  input.album = { ...input.album, mode: "create", title: "New" };
  input.discs[0].tracks = [track(1, "Intro")];
  input.artists = { a: "Q10", b: "Q11" };
  const edits = [edit({ key: "album", qid: "Q1" }), edit({ key: "track:0:1", qid: "Q3" })];
  const run = { input, edits };

  it("is behind when the form is the run's without its QIDs", () => {
    expect(formOfRun(structuredClone(input), run)).toBe("behind");
  });

  it("is behind when the form has only some of them", () => {
    const s = structuredClone(input);
    applyCreated(s, edits.slice(1));
    expect(formOfRun(s, run)).toBe("behind");
  });

  it("is the same once they're all written in, whatever the key order", () => {
    const s = structuredClone(input);
    applyCreated(s, edits);
    s.artists = { b: "Q11", a: "Q10" };
    expect(formOfRun(s, run)).toBe("same");
  });

  it("is the same for a new single once the lookup records it as one", () => {
    const single = structuredClone(input);
    single.album.type = SINGLE_CLASS;
    const s = structuredClone(single);
    applyCreated(s, edits);
    s.album.singleQid = "Q1";
    expect(formOfRun(s, { input: single, edits })).toBe("same");
  });

  it("is the same for a run that created nothing", () => {
    expect(formOfRun(structuredClone(input), { input, edits: [] })).toBe("same");
  });

  it("is another form once anything else differs", () => {
    const s = structuredClone(input);
    s.discs[0].tracks[0].title = "Outro";
    expect(formOfRun(s, run)).toBe("other");
    expect(formOfRun(structuredClone(EMPTY), run)).toBe("other");
  });

  it("is another form when it has a different QID where the run created one", () => {
    const s = structuredClone(input);
    s.discs[0].track[1] = "Q99";
    expect(formOfRun(s, run)).toBe("other");
  });

  it("doesn't change the form", () => {
    const s = structuredClone(input);
    formOfRun(s, run);
    expect(s).toEqual(input);
  });
});

describe("afterOwnRun", () => {
  const input = structuredClone(EMPTY);
  input.album = { ...input.album, mode: "create", title: "New" };
  input.discs[0].tracks = [track(1, "Intro"), track(2, "Outro")];
  const edits = [edit({ key: "album", qid: "Q1" }), edit({ key: "track:0:1", qid: "Q3" })];

  it("clears the run's form once the run is done", () => {
    expect(afterOwnRun(structuredClone(input), { status: "done", input, edits })).toBe("clear");
    const s = structuredClone(input);
    applyCreated(s, edits);
    expect(afterOwnRun(s, { status: "done", input, edits })).toBe("clear");
  });

  it("writes the QIDs of a run that didn't finish back into its form", () => {
    for (const status of ["failed", "interrupted", "unknown"] as const) {
      expect(afterOwnRun(structuredClone(input), { status, input, edits })).toBe("apply");
      expect(afterOwnRun(structuredClone(input), { status, input, edits: [] })).toBe("none");
    }
  });

  it("leaves a form changed since the run started alone", () => {
    // Removing track 1 renumbers "Outro" as track 1, which would get the old track 1's QID.
    const s = structuredClone(input);
    removeTrack(s.discs[0], 0);
    for (const status of ["done", "failed"] as const)
      expect(afterOwnRun(s, { status, input, edits })).toBe("none");
  });
});
