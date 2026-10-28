import { describe, expect, it } from "vite-plus/test";
import {
  type AlbumRow,
  artistAlbums,
  artistSingles,
  queryQid,
  rankArtists,
  type SingleRow,
} from "./artists.ts";
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

describe("artistSingles", () => {
  const single = (qid: number, label: string, released: string | null): SingleRow => ({
    qid,
    label,
    released,
    parts: null,
  });
  const none = { tracks: new Map(), takenFrom: new Map(), labels: new Map() };

  it("sorts like albums: oldest first, undated last, and same dates by title", () => {
    const rows = [
      single(1, "Good Time", "2012-06-26"),
      single(2, "Untitled", null),
      single(3, "Vanilla Twilight", "2009-11-03"),
      single(4, "Fireflies", "2009-11-03"),
    ];
    expect(artistSingles(rows, none).map((s) => s.label)).toEqual([
      "Fireflies",
      "Vanilla Twilight",
      "Good Time",
      "Untitled",
    ]);
  });

  it("counts its tracks", () => {
    const [s] = artistSingles([single(1, "Fireflies", "2009")], {
      ...none,
      tracks: new Map([[1, 2]]),
    });
    expect(s).toEqual({
      qid: "Q1",
      label: "Fireflies",
      released: "2009",
      tracks: 2,
      parts: null,
      takenFrom: [],
    });
  });

  it("passes on its number of parts", () => {
    const [s] = artistSingles([{ ...single(1, "Fireflies", "2009"), parts: 3 }], none);
    expect(s.parts).toBe(3);
  });

  it("resolves the albums it's taken from, by label", () => {
    const singles = artistSingles(
      [
        single(1, "Standalone", "2014"),
        single(2, "Fireflies", "2009"),
        single(3, "Good Time", "2012"),
      ],
      {
        ...none,
        takenFrom: new Map([
          [2, [40]],
          // The artist's album, and a compilation that isn't the artist's.
          [3, [41, 50]],
        ]),
        labels: new Map([
          [40, "Ocean Eyes"],
          [41, "The Midsummer Station"],
          [50, "Now That's What I Call Music! 44"],
        ]),
      },
    );
    expect(singles.map((s) => [s.label, s.takenFrom])).toEqual([
      ["Fireflies", [{ qid: "Q40", label: "Ocean Eyes" }]],
      [
        "Good Time",
        [
          { qid: "Q50", label: "Now That's What I Call Music! 44" },
          { qid: "Q41", label: "The Midsummer Station" },
        ],
      ],
      ["Standalone", []],
    ]);
  });

  it("has no label for an album that isn't in the mirror", () => {
    const [s] = artistSingles([single(1, "Fireflies", "2009")], {
      ...none,
      takenFrom: new Map([[1, [99]]]),
    });
    expect(s.takenFrom).toEqual([{ qid: "Q99", label: null }]);
  });
});

describe("albumType", () => {
  it("names the album's class, or plain Album", () => {
    expect(albumType("ep", ["Q169930"])).toBe("EP");
    expect(albumType("album", ["Q482994", "Q209939"])).toBe("Live album");
    expect(albumType("album", ["Q482994"])).toBe("Album");
  });
});
