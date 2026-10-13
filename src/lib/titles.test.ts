import { describe, expect, it } from "vite-plus/test";
import { foldTitle, labelSearchKey, sameTitle, titleKey } from "./titles.ts";

const key = labelSearchKey;

describe("titleKey", () => {
  it("lowercases and evens out spacing", () => {
    expect(titleKey("  Hello   World ")).toBe("hello world");
  });
  it("makes quote and apostrophe variants straight", () => {
    expect(titleKey("Don’t Say “Hi”")).toBe(`don't say "hi"`);
    expect(titleKey("Don′t ´n` ‛n ʼn")).toBe("don't 'n' 'n 'n");
    expect(titleKey("„Hi‟ «Hi» ″Hi″")).toBe(`"hi" "hi" "hi"`);
  });
  it("makes Unicode hyphens ASCII ones", () => {
    expect(titleKey("Post Break‐Up Sex")).toBe("post break-up sex");
    expect(titleKey("Break‑Up")).toBe("break-up");
  });
  it("keeps en and em dashes, which only match as similar", () => {
    expect(sameTitle("Hello – Goodbye", "Hello - Goodbye")).toBe(false);
  });
  it("composes accents, so either encoding is the same title", () => {
    expect(sameTitle("Café", "Café")).toBe(true);
    expect(sameTitle("Café", "Cafe")).toBe(false);
  });
});

describe("labelSearchKey", () => {
  it("clips to the index length and passes null through", () => {
    expect(key("x".repeat(300))).toHaveLength(191);
    expect(key(null)).toBeNull();
    expect(key("")).toBeNull();
  });

  it.each([
    ["Post Break‐Up Sex", "Post Break-Up Sex"],
    ["Don't Stop", "Dont Stop"],
    ["Don’t Stop", "Don't Stop"],
    ["Day and Night", "Day & Night"],
    ["Day and Night", "Day&Night"],
    ["Hello, Goodbye", "Hello Goodbye"],
    ["Hello – Goodbye", "Hello - Goodbye"],
    ["Hello—Goodbye", "Hello - Goodbye"],
    ["Café", "Cafe"],
    ["Mötley Crüe", "Motley Crue"],
    ["Straße", "Strasse"],
    ["Ægir", "Aegir"],
    ["Hello  Goodbye", "Hello Goodbye"],
    ["«Bonjour»", "Bonjour"],
    ["Rock ′n′ Roll", "Rock n Roll"],
    ["AC/DC Song", "AC DC Song"],
  ])("folds %j and %j alike", (a, b) => {
    expect(key(a)).toBe(key(b));
  });

  it.each([
    ["Day and Night", "Night and Day"],
    ["Break-Up", "Breakup"],
    ["Cafe", "Cafes"],
  ])("keeps %j and %j apart", (a, b) => {
    expect(key(a)).not.toBe(key(b));
  });

  describe("titles that are mostly punctuation", () => {
    it("never fold to an empty key", () => {
      expect(foldTitle("?")).toBe("");
      expect(key("?")).toBe("?");
      expect(key("...")).toBe("...");
      expect(key("!!!")).toBe("!!!");
    });
    it("don't collide with each other or with a title without the punctuation", () => {
      const keys = ["?", "!", "...", "#1", "1", "#!", "O.K.", "OK", "Up!", "Up"].map(key);
      expect(new Set(keys).size).toBe(keys.length);
    });
    it("can't collide with a folded title", () => {
      expect(key("#1")).not.toBe(key("1 1 1"));
      expect(key("O.K.")).toBe("o.k.");
      expect(key("O.K. Computer")).toBe("ok computer");
    });
  });

  describe("other scripts", () => {
    it("keep their marks", () => {
      // Hindi vowel signs, Arabic harakat, Hebrew niqqud.
      for (const t of ["दिल से", "حُبّ", "שָׁלוֹם"]) expect(key(t)).toBe(titleKey(t));
      expect(key("मैं")).not.toBe(key("में"));
    });
    it("keep Vietnamese tone marks, where they change the word", () => {
      expect(key("Mẹ")).not.toBe(key("Me"));
      expect(key("Người ta")).toBe("người ta");
      expect(key("Người ta")).not.toBe(key("Nguoi ta"));
    });
    it("still fold their punctuation", () => {
      expect(key("「東京タワー」")).toBe(key("東京タワー"));
      expect(key("Привет, мир!")).toBe("привет мир");
    });
  });
});
