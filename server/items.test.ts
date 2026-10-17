import { describe, expect, it } from "vite-plus/test";
import { searchKinds, type Selected, withAlbumFacts } from "./items.ts";

describe("searchKinds", () => {
  it("reads one kind or several, and drops unknown ones", () => {
    expect(searchKinds("artist")).toEqual(["artist"]);
    expect(searchKinds("album,ep")).toEqual(["album", "ep"]);
    expect(searchKinds(" album , ep,album,band")).toEqual(["album", "ep"]);
  });
  it("is any kind when none is asked for", () => {
    expect(searchKinds(undefined)).toEqual([]);
    expect(searchKinds("")).toEqual([]);
    expect(searchKinds("band")).toEqual([]);
  });
});

describe("withAlbumFacts", () => {
  const row = (qid: number, kind: string, label: string): Selected => ({
    qid,
    kind,
    label,
    description: null,
  });

  it("gives albums and EPs their track count and MusicBrainz status", () => {
    const rows = [
      row(1, "album", "Day and Night"),
      row(2, "album", "Day and Night"),
      row(3, "ep", "Day & Night"),
    ];
    expect(withAlbumFacts(rows, new Map([[2, 10]]), new Set([1]))).toEqual([
      {
        qid: "Q1",
        kind: "album",
        label: "Day and Night",
        description: null,
        album: { tracks: 0, musicBrainz: true },
      },
      {
        qid: "Q2",
        kind: "album",
        label: "Day and Night",
        description: null,
        album: { tracks: 10, musicBrainz: false },
      },
      {
        qid: "Q3",
        kind: "ep",
        label: "Day & Night",
        description: null,
        album: { tracks: 0, musicBrainz: false },
      },
    ]);
  });

  it("leaves other kinds as they are", () => {
    expect(withAlbumFacts([row(4, "artist", "Goldfish")], new Map(), new Set([4]))).toEqual([
      { qid: "Q4", kind: "artist", label: "Goldfish", description: null },
    ]);
  });
});
