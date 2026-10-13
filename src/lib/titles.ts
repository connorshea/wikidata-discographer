// How titles are compared. The client and server share these, so a typed
// title and a stored label fold alike.
//
// There are two keys. `titleKey` only evens out how the same title can be
// typed: case, curly or straight quotes and apostrophes, Unicode hyphens and
// spacing. Two titles with the same `titleKey` are the "same title".
// `labelSearchKey` folds further, for finding "similar title" items: `&` and
// "and", punctuation, dashes and accents. It's the key stored in the mirror's
// `label_search` column, so changing it means re-keying the mirror
// (jobs/rekey-titles.ts).

/** The length of the indexed `label_search` column. */
export const LABEL_SEARCH_LENGTH = 191;

/** The reason given for an item whose title only matches once folded. */
export const SIMILAR_TITLE = "similar title";

const APOSTROPHES = /[’‘‛ʼ′´`]/g;
const QUOTES = /[“”„‟″«»]/g;
// Hyphen and non-breaking hyphen: MusicBrainz style uses U+2010, Wikidata labels "-".
const HYPHENS = /[‐‑]/g;

/**
 * The key for "same title": lowercased, with quote and apostrophe variants
 * made straight, Unicode hyphens made "-", and runs of whitespace made one
 * space.
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(HYPHENS, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Latin letters that don't decompose into a base letter and a mark.
const LATIN_LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
};
// Horn, hook above and dot below: marks that mean a title is Vietnamese,
// where removing them changes the word.
const VIETNAMESE_MARKS = /[̛̣̉]/;
const LATIN = /\p{Script=Latin}/u;
const MARK = /\p{M}/u;

/** `s` (decomposed) without the marks on Latin letters. Other scripts keep theirs. */
function stripLatinMarks(nfd: string): string {
  let out = "";
  let afterLatin = false;
  for (const ch of nfd) {
    if (MARK.test(ch)) {
      if (!afterLatin) out += ch;
      continue;
    }
    afterLatin = LATIN.test(ch);
    out += LATIN_LETTERS[ch] ?? ch;
  }
  return out;
}

/**
 * `titleKey` folded further: `&` read as "and", accents on Latin letters
 * removed (unless the title is Vietnamese), dashes and slashes made spaces,
 * and other punctuation and symbols dropped. Can be empty.
 */
export function foldTitle(title: string): string {
  let s = titleKey(title).replace(/&/g, " and ");
  const nfd = s.normalize("NFD");
  s = VIETNAMESE_MARKS.test(nfd) ? s : stripLatinMarks(nfd).normalize("NFC");
  return s
    .replace(/[\p{Pd}/\\]/gu, " ")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fewer letters and digits than this left after folding, and the title is
// mostly punctuation ("?", "#1", "...", "O.K."): use `titleKey` instead, so
// it can't fold to nothing or into another title.
const MIN_FOLDED = 3;

/**
 * The key a label is searched and matched by (`label_search`): `foldTitle`,
 * or `titleKey` for a title that is mostly punctuation, clipped to the index
 * length. A folded key always has at least MIN_FOLDED letters or digits, and
 * a fallback fewer, so the two never collide.
 */
export function labelSearchKey(label: string | null | undefined): string | null {
  if (!label) return null;
  const folded = foldTitle(label);
  const letters = folded.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const key = letters >= MIN_FOLDED ? folded : titleKey(label);
  return key ? Array.from(key).slice(0, LABEL_SEARCH_LENGTH).join("") : null;
}

/** Whether two titles are the same, not only similar. */
export const sameTitle = (a: string, b: string) => titleKey(a) === titleKey(b);
