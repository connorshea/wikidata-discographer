import { describe, expect, it } from "vite-plus/test";
import { artistStart, existingAlbum } from "./artist-start.ts";

describe("artistStart", () => {
  it("reads the album, and its release group if it's an MBID", () => {
    expect(artistStart("?album=Q42")).toEqual({ album: "Q42", rg: null });
    expect(artistStart("?album=q42&rg=6A3F8B1E-7C4D-4E2B-9F1A-0B2C3D4E5F60")).toEqual({
      album: "Q42",
      rg: "6a3f8b1e-7c4d-4e2b-9f1a-0b2c3d4e5f60",
    });
    expect(artistStart("?album=Q42&rg=nope")).toEqual({ album: "Q42", rg: null });
  });

  it("is null without an album QID", () => {
    expect(artistStart("")).toBeNull();
    expect(artistStart("?run=3")).toBeNull();
    expect(artistStart("?album=Owl")).toBeNull();
  });
});

describe("existingAlbum", () => {
  it("starts an empty form from the album", () => {
    const s = existingAlbum("Q42");
    expect(s.start).toBe("existing");
    expect(s.album).toMatchObject({ mode: "existing", qid: "Q42" });
  });
});
