import { describe, expect, it } from "vite-plus/test";
import { groupAlbums, type RunEdits, type RunRow } from "./albums.ts";

const run = (id: number, albumQid: number, extra: Partial<RunRow> = {}): RunRow => ({
  id,
  albumQid,
  userId: 1,
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
      null,
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
      null,
    );
    expect(created.created).toBe(true);
    expect(created.runs.map((r) => [r.created, r.createdAlbum])).toEqual([
      [1, false],
      [5, true],
    ]);
    expect(populated.created).toBe(false);
  });

  it("counts nothing for a run with no edits", () => {
    const [album] = groupAlbums([100], [run(1, 100)], new Map(), new Map(), null);
    expect(album.runs[0]).toMatchObject({ created: 0, createdAlbum: false });
  });

  it("uses the mirror's label, else the latest run's title", () => {
    const runs = [run(1, 100), run(2, 100, { title: "Typed later" }), run(3, 200)];
    const albums = groupAlbums([100, 200], runs, new Map(), new Map([[200, "On Wikidata"]]), null);
    expect(albums.map((a) => a.label)).toEqual(["Typed later", "On Wikidata"]);
  });

  it("marks the viewer's own runs and keeps every status", () => {
    const [album] = groupAlbums(
      [100],
      [
        run(1, 100, { status: "unknown" }),
        run(2, 100, { userId: 2, username: "Bob", status: "failed" }),
      ],
      new Map(),
      new Map(),
      1,
    );
    expect(album.runs.map((r) => [r.username, r.status, r.mine])).toEqual([
      ["Bob", "failed", false],
      ["Alice", "unknown", true],
    ]);
    expect(album.runs[0].editGroupUrl).toBe("https://editgroups.toolforge.org/b/CB/g2/");
  });

  it("skips an album with no runs", () => {
    expect(groupAlbums([100], [], new Map(), new Map(), null)).toEqual([]);
  });
});
