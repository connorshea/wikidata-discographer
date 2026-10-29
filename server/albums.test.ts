import { describe, expect, it } from "vite-plus/test";
import { groupAlbums, inputType, mirrorType, type RunEdits, type RunRow } from "./albums.ts";

const run = (id: number, albumQid: number, extra: Partial<RunRow> = {}): RunRow => ({
  id,
  albumQid,
  username: "Alice",
  status: "done",
  title: `Run ${id}`,
  editGroup: `g${id}`,
  createdAt: "2026-10-04 12:00:00",
  finishedAt: null,
  ...extra,
});

describe("groupAlbums", () => {
  it("lists each album once, in the page's order, with its runs newest first", () => {
    const albums = groupAlbums(
      [100, 200],
      [run(1, 100), run(2, 200), run(3, 100)],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(albums.map((a) => [a.qid, a.runs.map((r) => r.id)])).toEqual([
      ["Q100", [3, 1]],
      ["Q200", [2]],
    ]);
  });

  it("tells a created album from one that was added to", () => {
    const edits = new Map<number, RunEdits>([
      [1, { created: 5, createdAlbum: true }],
      [2, { created: 3, createdAlbum: false }],
      [3, { created: 1, createdAlbum: false }],
    ]);
    const [created, populated] = groupAlbums(
      [100, 200],
      [run(1, 100), run(3, 100), run(2, 200)],
      edits,
      new Map(),
      new Map(),
      new Map(),
    );
    expect(created.created).toBe(true);
    expect(created.runs.map((r) => [r.created, r.createdAlbum])).toEqual([
      [1, false],
      [5, true],
    ]);
    expect(populated.created).toBe(false);
  });

  it("counts nothing for a run with no edits", () => {
    const [album] = groupAlbums([100], [run(1, 100)], new Map(), new Map(), new Map(), new Map());
    expect(album.runs[0]).toMatchObject({ created: 0, createdAlbum: false });
  });

  it("uses the mirror's label, else the latest run's title", () => {
    const runs = [run(1, 100), run(2, 100, { title: "Typed later" }), run(3, 200)];
    const albums = groupAlbums(
      [100, 200],
      runs,
      new Map(),
      new Map([[200, "On Wikidata"]]),
      new Map(),
      new Map(),
    );
    expect(albums.map((a) => a.label)).toEqual(["Typed later", "On Wikidata"]);
  });

  it("gives each album its performers, or none", () => {
    const albums = groupAlbums(
      [100, 200],
      [run(1, 100), run(2, 200)],
      new Map(),
      new Map(),
      new Map([[100, [{ qid: "Q1", label: "Carly Rae Jepsen" }]]]),
      new Map(),
    );
    expect(albums.map((a) => a.artists)).toEqual([[{ qid: "Q1", label: "Carly Rae Jepsen" }], []]);
  });

  it("gives each album its type, or null", () => {
    const albums = groupAlbums(
      [100, 200],
      [run(1, 100), run(2, 200)],
      new Map(),
      new Map(),
      new Map(),
      new Map([[100, "EP"]]),
    );
    expect(albums.map((a) => a.type)).toEqual(["EP", null]);
  });

  it("keeps every user's runs and every status", () => {
    const [album] = groupAlbums(
      [100],
      [run(1, 100, { status: "unknown" }), run(2, 100, { username: "Bob", status: "failed" })],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(album.runs.map((r) => [r.username, r.status])).toEqual([
      ["Bob", "failed"],
      ["Alice", "unknown"],
    ]);
    expect(album.runs[0].editGroupUrl).toBe("https://editgroups.toolforge.org/b/CB/g2/");
  });

  it("skips an album with no runs", () => {
    expect(groupAlbums([100], [], new Map(), new Map(), new Map(), new Map())).toEqual([]);
  });
});

describe("mirrorType", () => {
  it("names a release's type", () => {
    expect(mirrorType("album", [482994, 209939])).toBe("Live album");
    expect(mirrorType("ep", [169930])).toBe("EP");
    expect(mirrorType("single", [134556])).toBe("Single");
  });

  it("gives nothing for an item that isn't a release", () => {
    expect(mirrorType("track", [55850593])).toBeNull();
  });
});

describe("inputType", () => {
  const album = (a: Record<string, unknown>) => ({ album: a });

  it("reads a new release's type and form", () => {
    expect(inputType(album({ mode: "create", type: "Q482994", form: "" }))).toBe("Album");
    expect(inputType(album({ mode: "create", type: "Q482994", form: "Q222910" }))).toBe(
      "Compilation",
    );
    expect(inputType(album({ mode: "create", type: "Q169930", form: "Q209939" }))).toBe("EP");
    expect(inputType(album({ mode: "create", type: "Q134556" }))).toBe("Single");
  });

  it("calls an existing single a single", () => {
    expect(inputType(album({ mode: "existing", qid: "Q5", singleQid: "Q5" }))).toBe("Single");
  });

  it("doesn't guess an existing release's type", () => {
    expect(inputType(album({ mode: "existing", qid: "Q5", singleQid: "" }))).toBeNull();
    expect(inputType(album({ mode: "existing", qid: "Q6", singleQid: "Q5" }))).toBeNull();
  });
});
