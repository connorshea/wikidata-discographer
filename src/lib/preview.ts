// The plan as something a person can check before making the edits: one entry
// per edit, grouped by what it makes or changes, with labels for the
// properties and items the app knows and new items called by their titles.
import { ID_PROPERTIES, LINK_PROPERTIES } from "./music.ts";
import {
  ALBUM_FORMS,
  ALBUM_TYPES,
  type Claim,
  COMPOSITION_CLASS,
  describeOp,
  LABEL_LANGS,
  LANGS,
  NO_LINGUISTIC_CONTENT,
  type Op,
  PARTS,
  type Plan,
  SECOND_UNIT,
  SINGLE_CLASS,
  type Snak,
  MUSICBRAINZ,
  SONG_FORM,
  type State,
  TRACK_TYPES,
  TRACK_UNIT,
  type Value,
} from "./plan.ts";

/** Labels for every property the plan writes. */
export const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  ...ID_PROPERTIES,
  ...LINK_PROPERTIES,
  P31: "instance of",
  P7937: "form of creative work",
  P1476: "title",
  P577: "publication date",
  P407: "language of work or name",
  P2635: "number of parts of this work",
  P518: "applies to part",
  P1545: "series ordinal",
  P2047: "duration",
  P1243: "ISRC",
  P13602: "single taken from",
  P248: "stated in",
  P813: "retrieved",
};

const LANGUAGE_NAMES: ReadonlyMap<string, string> = new Map(LABEL_LANGS);

/** A value as shown: `qid` links it to Wikidata; `isNew` marks an item this run creates. */
export interface PreviewValue {
  text: string;
  qid?: string;
  isNew?: boolean;
}

export interface PreviewProperty {
  id: string;
  /** Null when the app doesn't know the property. */
  label: string | null;
}

export interface PreviewStatement {
  property: PreviewProperty;
  value: PreviewValue;
  qualifiers: { property: PreviewProperty; value: PreviewValue }[];
  /** Each reference's snaks. */
  references: { property: PreviewProperty; value: PreviewValue }[][];
  /** Only added if the item has no statement for the property yet. */
  ifMissing?: true;
}

export interface PreviewEdit {
  /** Its place in the run, from 1. */
  n: number;
  /** As the run log will describe it, e.g. `Create track “Versailles”`. */
  heading: string;
  /** The item a statements edit changes. */
  target: PreviewValue | null;
  /** A create's labels and descriptions. */
  terms: { kind: "Label" | "Description"; language: string; text: string }[];
  statements: PreviewStatement[];
}

export type PreviewGroupId = "album" | "comp" | "track" | "single" | "existing";

export interface PreviewGroup {
  id: PreviewGroupId;
  title: string;
  edits: PreviewEdit[];
}

const GROUPS: readonly (readonly [PreviewGroupId, string])[] = [
  ["album", "Album"],
  ["comp", "Compositions"],
  ["track", "Tracks"],
  ["single", "Singles"],
  ["existing", "Existing items"],
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A Wikibase time at year, month or day precision, e.g. "18 September 2026". */
export function formatTime(time: string, precision: 9 | 10 | 11): string {
  const m = /^[+-](\d+)-(\d{2})-(\d{2})/.exec(time);
  if (!m) return time;
  const [, y, mo, d] = m;
  const year = String(Number(y));
  if (precision === 9 || mo === "00") return year;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  if (precision === 10 || d === "00") return `${month} ${year}`;
  return `${Number(d)} ${month} ${year}`;
}

/** Seconds as "4:12" or "1:02:03". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Names for the items the form knows: its fixed choices, performers and reused items. */
function itemNames(state: State, parsed: Plan["parsed"]): Map<string, string> {
  const fixed: (readonly [string, string])[] = [
    ...ALBUM_TYPES,
    ...ALBUM_FORMS,
    ...TRACK_TYPES,
    ...LANGS,
    ...PARTS.flatMap(([, options]): (readonly [string, string])[] => [...options]),
  ];
  const names = new Map<string, string>([
    ...fixed,
    [NO_LINGUISTIC_CONTENT, "no linguistic content"],
    [SINGLE_CLASS, "single"],
    [COMPOSITION_CLASS, "musical work/composition"],
    [SONG_FORM, "song"],
    [SECOND_UNIT, "second"],
    [MUSICBRAINZ, "MusicBrainz"],
  ]);
  const add = (qid: string | undefined, name: string) => {
    const q = qid?.trim();
    if (q && !names.has(q)) names.set(q, name);
  };
  if (state.album.mode === "existing") add(state.album.qid, "this album");
  for (const [name, qid] of Object.entries(state.artists)) add(qid, name);
  parsed.forEach((rows, di) => {
    const disc = state.discs[di];
    if (!disc) return;
    for (const r of rows) {
      if (r.error !== undefined) continue;
      add(disc.comp[r.n], `composition “${r.title}”`);
      add(disc.track[r.n], `track “${r.title}”`);
      add(disc.single[r.n]?.qid, `single “${r.title}”`);
    }
  });
  return names;
}

function groupOf(op: Op, albumQid: string | null): PreviewGroupId {
  if (op.op === "create") {
    if (op.kind === "album" || op.kind === "ep") return "album";
    if (op.kind === "work") return "comp";
    if (op.kind === "track" || op.kind === "single") return op.kind;
    return "existing";
  }
  if ("id" in op.target) return op.target.id === albumQid ? "album" : "existing";
  const prefix = op.target.ref.split(":")[0];
  return prefix === "comp" || prefix === "track" || prefix === "single" ? prefix : "album";
}

/** The plan's operations as grouped, labelled edits. */
export function previewPlan(plan: Pick<Plan, "ops" | "parsed">, state: State): PreviewGroup[] {
  const names = itemNames(state, plan.parsed);
  const created = new Map<string, string>();
  for (const op of plan.ops) if (op.op === "create") created.set(op.key, `new ${describeOp(op)}`);

  const item = (id: string): PreviewValue => ({ text: names.get(id) ?? id, qid: id });
  const value = (property: string, v: Value): PreviewValue => {
    switch (v.type) {
      case "item":
        return "id" in v ? item(v.id) : { text: created.get(v.ref) ?? v.ref, isNew: true };
      case "string":
        return { text: v.value };
      case "monolingual":
        return { text: `“${v.text}” (${LANGUAGE_NAMES.get(v.language) ?? v.language})` };
      case "time":
        return { text: formatTime(v.time, v.precision) };
      case "quantity":
        if (v.unit === SECOND_UNIT || (property === "P2047" && !v.unit))
          return { text: formatDuration(v.amount) };
        if (v.unit === TRACK_UNIT) return { text: `${v.amount} track${v.amount === 1 ? "" : "s"}` };
        return { text: v.unit ? `${v.amount} ${names.get(v.unit) ?? v.unit}` : String(v.amount) };
    }
  };
  const prop = (id: string): PreviewProperty => ({ id, label: PROPERTY_LABELS[id] ?? null });
  const snak = (s: Snak) => ({ property: prop(s.property), value: value(s.property, s.value) });
  const statement = (c: Claim): PreviewStatement => ({
    ...snak(c),
    qualifiers: (c.qualifiers ?? []).map(snak),
    references: (c.references ?? []).map((r) => r.map(snak)),
    ...(c.ifMissing ? { ifMissing: true as const } : {}),
  });

  const albumQid = state.album.mode === "existing" ? state.album.qid.trim() : null;
  const groups = new Map<PreviewGroupId, PreviewEdit[]>();
  plan.ops.forEach((op, i) => {
    const edit: PreviewEdit =
      op.op === "create"
        ? {
            n: i + 1,
            heading: `Create ${describeOp(op)}`,
            target: null,
            terms: [
              ...Object.entries(op.labels).map(([l, text]) => ({
                kind: "Label" as const,
                language: LANGUAGE_NAMES.get(l) ?? l,
                text,
              })),
              ...Object.entries(op.descriptions).map(([l, text]) => ({
                kind: "Description" as const,
                language: LANGUAGE_NAMES.get(l) ?? l,
                text,
              })),
            ],
            statements: op.claims.map(statement),
          }
        : {
            n: i + 1,
            heading: describeOp(op),
            target: value("", { type: "item", ...op.target }),
            terms: [],
            statements: op.claims.map(statement),
          };
    const g = groupOf(op, albumQid);
    const list = groups.get(g);
    if (list) list.push(edit);
    else groups.set(g, [edit]);
  });
  return GROUPS.filter(([id]) => groups.has(id)).map(([id, title]) => ({
    id,
    title,
    edits: groups.get(id)!,
  }));
}
