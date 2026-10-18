import { describe, expect, it } from "vite-plus/test";
import { type AlbumRow, artistAlbums, queryQid, rankArtists } from "./artists.ts";
import { albumType } from "../src/lib/music.ts";

describe("queryQid", () => {
  it("reads a QID or a Wikidata URL", () => {
    expect(queryQid("q52583")).toBe("Q52583");
    expect(queryQid("https://www.wikidata.org/wiki/Q52583")).toBe("Q52583");
  });
  it("is null for a name", () => {
    expect(queryQid("Owl City")).toBeNull();
    expect(queryQid("Q")).toBeNull();
  });
});

describe("rankArtists", () => {
  it("puts exact matches first, then the artists with the most albums", () => {
    const found = [
      { qid: 1, exact: true },
      { qid: 2, exact: true },
      { qid: 3, exact: false },
      { qid: 4, exact: false },
    ];
    const albums = new Map([
      [2, 11],
      [3, 40],
      [4, 1],
    ]);
    expect(rankArtists(found, albums)).toEqual([2, 1, 3, 4]);
  });
  it("keeps the search's order between equals", () => {
    expect(
      rankArtists(
        [
          { qid: 5, exact: false },
          { qid: 6, exact: false },
        ],
        new Map(),
      ),
    ).toEqual([5, 6]);
  });
});

describe("artistAlbums", () => {
  const row = (qid: number, label: string, released: string | null, kind = "album"): AlbumRow => ({
    qid,
    kind,
    label,
    instanceOf: kind === "ep" ? [169930] : [208569],
    released,
  });
  const none = { parts: new Map(), tracks: new Map(), releaseGroups: new Map(), runs: [] };

  it("sorts oldest first, undated last, and same dates by title", () => {
    const rows = [
      row(1, "Cinematic", "2018-06-01"),
      row(2, "Untitled", null),
      row(3, "Shooting Star", "2012-05-15", "ep"),
      row(4, "Of June", "2007"),
      row(5, "The Midsummer Station", "2012-05-15"),
    ];
    expect(artistAlbums(rows, none, null).map((a) => [a.label, a.type])).toEqual([
      ["Of June", "Studio album"],
      ["Shooting Star", "EP"],
      ["The Midsummer Station", "Studio album"],
      ["Cinematic", "Studio album"],
      ["Untitled", "Studio album"],
    ]);
  });

  it("gives each album its facts and its latest run", () => {
    const run = (id: number, userId: number, status: string) => ({
      id,
      albumQid: 1,
      userId,
      status,
      editGroup: `g${id}`,
      createdAt: "2026-10-17 18:00:00",
    });
    const [album] = artistAlbums(
      [row(1, "Ocean Eyes", "2009")],
      {
        parts: new Map([[1, 16]]),
        tracks: new Map([[1, 14]]),
        releaseGroups: new Map([[1, ["mbid"]]]),
        runs: [run(3, 7, "failed"), run(9, 7, "done"), run(4, 8, "done")],
      },
      7,
    );
    expect(album).toEqual({
      qid: "Q1",
      label: "Ocean Eyes",
      type: "Studio album",
      released: "2009",
      tracks: 14,
      parts: 16,
      releaseGroups: ["mbid"],
      run: {
        id: 9,
        status: "done",
        mine: true,
        createdAt: "2026-10-17 18:00:00",
        editGroupUrl: "https://editgroups.toolforge.org/b/CB/g9/",
      },
    });
  });
});

describe("albumType", () => {
  it("names the album's class, or plain Album", () => {
    expect(albumType("ep", ["Q169930"])).toBe("EP");
    expect(albumType("album", ["Q482994", "Q209939"])).toBe("Live album");
    expect(albumType("album", ["Q482994"])).toBe("Album");
  });
});
