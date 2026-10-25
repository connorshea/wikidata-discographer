// The local mirror of Wikidata music items (`music_items`,
// `music_external_ids` and `music_links`): converting an entity to a row, and writing rows. Used
// by the weekly dump import, by runs (each created item is added straight
// away), and by "add an item" for things created since the last dump.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, retryOnLockConflict } from "./db.ts";
import { propertyNumber, qidNumber, toQid } from "./ids.ts";
import { mirrorState, musicExternalIds, musicItems, musicLinks } from "../db/schema.ts";
import { ID_PROPERTIES, kindOf, LINK_PROPERTIES, type MusicKind } from "../src/lib/music.ts";
import { labelSearchKey, TITLE_KEY_VERSION } from "../src/lib/titles.ts";
import type { Entity, WikibaseStatement } from "./wikidata-client.ts";

/**
 * The version of what `entityToRow` extracts. The dump import skips items
 * whose revision it has already mirrored, so bump this whenever the row's
 * contents change (a new column, a class added or removed): rows from an
 * older version are then re-read from the next dump.
 */
export const MIRROR_VERSION = 6; // 2: music_links, and curly quotes in label_search. 3: folded label_search. 4: P13602 links. 5: released and parts. 6: P1552 links

export interface MirrorRow {
  qid: string;
  /** The revision the row was built from, if known. */
  revid: number | null;
  kind: MusicKind;
  label: string | null;
  description: string | null;
  instanceOf: string[];
  /** The earliest publication date (P577): "YYYY", "YYYY-MM" or "YYYY-MM-DD", by its precision. */
  released: string | null;
  /** Its number of parts (P2635), if a whole number. */
  parts: number | null;
  ids: { property: string; value: string }[];
  /** Item-valued statements (LINK_PROPERTIES); none for artists. */
  links: { property: string; target: string }[];
}

const clip = (s: string | undefined, n: number) => (s ? Array.from(s).slice(0, n).join("") : null);

function pickText(texts: Entity["labels"]): string | undefined {
  if (!texts) return undefined;
  return (texts.en ?? texts.mul ?? Object.values(texts)[0])?.value;
}

/** Best-rank statements: the preferred ones if any, else the normal ones. */
function bestRank(statements: WikibaseStatement[] = []): WikibaseStatement[] {
  const preferred = statements.filter((s) => s.rank === "preferred");
  return preferred.length ? preferred : statements.filter((s) => s.rank !== "deprecated");
}

/** A time value as "YYYY", "YYYY-MM" or "YYYY-MM-DD", by its precision. Null below year precision, or BCE. */
export function dateText(value: unknown): string | null {
  const v = value as { time?: unknown; precision?: unknown } | undefined;
  if (typeof v?.time !== "string" || typeof v.precision !== "number" || v.precision < 9)
    return null;
  const m = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(v.time);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (v.precision === 9 || mo === "00") return y;
  if (v.precision === 10 || d === "00") return `${y}-${mo}`;
  return `${y}-${mo}-${d}`;
}

/** The earliest of an entity's publication dates (P577). */
function releasedOf(statements: WikibaseStatement[] | undefined): string | null {
  const dates = bestRank(statements)
    .map((s) => dateText(s.mainsnak.datavalue?.value))
    .filter((d): d is string => d !== null);
  // A year sorts before the dates in it, so a vaguer date of the same year wins.
  return dates.length ? dates.sort()[0] : null;
}

/** Its number of parts (P2635), when that's a whole number that fits the column. */
function partsOf(statements: WikibaseStatement[] | undefined): number | null {
  const [s] = bestRank(statements);
  const amount = Number((s?.mainsnak.datavalue?.value as { amount?: unknown } | undefined)?.amount);
  return Number.isInteger(amount) && amount > 0 && amount < 2 ** 31 ? amount : null;
}

/** The mirror row for an entity, or null when it isn't a music item we track. */
export function entityToRow(entity: Entity): MirrorRow | null {
  if (!/^Q\d+$/.test(entity.id)) return null;
  const claims = entity.claims ?? {};
  const instanceOf = bestRank(claims.P31)
    .map((s) => (s.mainsnak.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => typeof id === "string" && /^Q\d+$/.test(id));
  const kind = kindOf(instanceOf, Object.keys(claims));
  if (!kind) return null;
  const ids: MirrorRow["ids"] = [];
  const seen = new Set<string>();
  for (const property of Object.keys(ID_PROPERTIES)) {
    for (const s of claims[property] ?? []) {
      const value = s.mainsnak.datavalue?.value;
      if (s.rank === "deprecated" || typeof value !== "string" || value.length > 400) continue;
      const k = `${property}\t${value}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ids.push({ property, value });
    }
  }
  const links: MirrorRow["links"] = [];
  // Artists are only ever link targets; their own item links aren't needed.
  // Not capped: the most any music item has is ~100 (a tracklist's P658).
  if (kind !== "artist")
    for (const property of Object.keys(LINK_PROPERTIES)) {
      const targets = new Set<string>();
      for (const s of claims[property] ?? []) {
        const id = (s.mainsnak.datavalue?.value as { id?: unknown } | undefined)?.id;
        if (s.rank !== "deprecated" && typeof id === "string" && /^Q\d+$/.test(id)) targets.add(id);
      }
      for (const target of targets) links.push({ property, target });
    }
  const label = pickText(entity.labels);
  return {
    qid: entity.id,
    revid: typeof entity.lastrevid === "number" ? entity.lastrevid : null,
    kind,
    label: clip(label, 400),
    description: clip(pickText(entity.descriptions), 400),
    instanceOf,
    released: kind === "artist" ? null : releasedOf(claims.P577),
    parts: kind === "artist" ? null : partsOf(claims.P2635),
    ids,
    links,
  };
}

/**
 * Insert or update rows and make their external ids and links match. A row older than
 * the one stored (a lower revid) is left out, so a dump read while the app
 * wrote a newer revision can't undo it. Retried on a deadlock or lock timeout.
 */
export async function upsertRows(
  input: readonly MirrorRow[],
  opts: { source: "dump" | "app" },
): Promise<void> {
  if (input.length === 0) return;
  await retryOnLockConflict(`mirror write (${input.length} rows)`, () =>
    db.transaction(async (tx) => {
      // Locked, so an app write can't land between this check and the write.
      const have = await tx
        .select({ qid: musicItems.qid, revid: musicItems.revid })
        .from(musicItems)
        .where(
          inArray(
            musicItems.qid,
            input.map((r) => qidNumber(r.qid)),
          ),
        )
        .for("update");
      const stored = new Map(have.map((r) => [r.qid, r.revid]));
      const rows = input.filter((r) => {
        const revid = stored.get(qidNumber(r.qid));
        return revid == null || r.revid == null || r.revid >= revid;
      });
      if (rows.length === 0) return;
      await writeRows(tx, rows, opts.source);
    }),
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeRows(tx: Tx, rows: readonly MirrorRow[], source: "dump" | "app") {
  const values = rows.map((r) => ({
    qid: qidNumber(r.qid),
    kind: r.kind,
    label: r.label,
    labelSearch: labelSearchKey(r.label),
    description: r.description,
    instanceOf: r.instanceOf.map(qidNumber),
    released: r.released,
    parts: r.parts,
    revid: r.revid,
    rowVersion: MIRROR_VERSION,
    source,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }));
  const qids = values.map((v) => v.qid);
  const ids = rows.flatMap((r) =>
    r.ids.map((id) => ({
      qid: qidNumber(r.qid),
      property: propertyNumber(id.property),
      value: id.value,
    })),
  );
  const links = rows.flatMap((r) =>
    r.links.map((l) => ({
      qid: qidNumber(r.qid),
      property: propertyNumber(l.property),
      target: qidNumber(l.target),
    })),
  );
  await tx
    .insert(musicItems)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        kind: sql`values(kind)`,
        label: sql`values(label)`,
        labelSearch: sql`values(label_search)`,
        description: sql`values(description)`,
        instanceOf: sql`values(instance_of)`,
        released: sql`values(released)`,
        parts: sql`values(parts)`,
        revid: sql`values(revid)`,
        rowVersion: sql`values(row_version)`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
  await tx.delete(musicExternalIds).where(inArray(musicExternalIds.qid, qids));
  if (ids.length) await tx.insert(musicExternalIds).values(ids);
  await tx.delete(musicLinks).where(inArray(musicLinks.qid, qids));
  if (links.length) await tx.insert(musicLinks).values(links);
}

/**
 * Mirrored items with exactly one of these labels and descriptions, up to
 * `limit`. The mirror keeps one label (English, else mul) and one description
 * (English, else any) per item, and may be behind Wikidata, so a hit is only
 * a candidate: its terms on Wikidata still need checking.
 */
export async function findByTerms(
  pairs: readonly { label: string; description: string }[],
  limit = 50,
): Promise<string[]> {
  const keys = [...new Set(pairs.map((p) => labelSearchKey(p.label)))].filter(
    (k): k is string => k !== null,
  );
  if (keys.length === 0) return [];
  const rows = await db
    .select({ qid: musicItems.qid, label: musicItems.label, description: musicItems.description })
    .from(musicItems)
    .where(
      and(
        inArray(musicItems.labelSearch, keys),
        inArray(musicItems.description, [...new Set(pairs.map((p) => p.description))]),
      ),
    )
    .limit(limit * 4);
  // The columns compare case-insensitively; Wikidata doesn't.
  const want = new Set(pairs.map((p) => JSON.stringify([p.label, p.description])));
  return rows
    .filter((r) => want.has(JSON.stringify([r.label, r.description])))
    .slice(0, limit)
    .map((r) => toQid(r.qid));
}

const REKEY_BATCH = 2000;

/**
 * Rebuild `label_search` from each stored label, for after `labelSearchKey`
 * changes. Reads the mirror in qid order, a batch at a time, and writes only
 * the keys that differ. A row whose label changed since it was read (an app
 * write in between) is left as that write keyed it. Returns how many rows were
 * read and how many re-keyed.
 */
async function rekeyLabels(
  opts: { onBatch?: (read: number, changed: number) => void } = {},
): Promise<{ read: number; changed: number }> {
  let after = 0;
  let read = 0;
  let changed = 0;
  for (;;) {
    const rows = await db
      .select({ qid: musicItems.qid, label: musicItems.label, key: musicItems.labelSearch })
      .from(musicItems)
      .where(sql`${musicItems.qid} > ${after}`)
      .orderBy(musicItems.qid)
      .limit(REKEY_BATCH);
    if (rows.length === 0) break;
    after = rows[rows.length - 1].qid;
    read += rows.length;
    const stale = rows
      .map((r) => ({ ...r, next: labelSearchKey(r.label) }))
      .filter((r) => r.next !== r.key);
    if (stale.length) {
      const cases = sql.join(
        stale.map(
          (r) =>
            sql`when ${musicItems.qid} = ${r.qid} and ${musicItems.label} <=> ${r.label} then ${r.next}`,
        ),
        sql` `,
      );
      await retryOnLockConflict(`re-key (${stale.length} rows)`, () =>
        db
          .update(musicItems)
          .set({ labelSearch: sql`case ${cases} else ${musicItems.labelSearch} end` })
          .where(
            inArray(
              musicItems.qid,
              stale.map((r) => r.qid),
            ),
          ),
      );
      changed += stale.length;
    }
    opts.onBatch?.(read, changed);
  }
  return { read, changed };
}

/** The TITLE_KEY_VERSION the mirror's `label_search` keys were built with (0 if never recorded). */
export async function storedTitleKeyVersion(): Promise<number> {
  const [row] = await db
    .select({ version: mirrorState.version })
    .from(mirrorState)
    .where(eq(mirrorState.name, "title_keys"));
  return row?.version ?? 0;
}

/**
 * Rebuild the mirror's title keys if they were built with an older
 * TITLE_KEY_VERSION, then record the current one. Returns how many rows were
 * re-keyed, or null if they were current.
 */
export async function rekeyIfBehind(
  opts: Parameters<typeof rekeyLabels>[0] = {},
): Promise<{ read: number; changed: number } | null> {
  if ((await storedTitleKeyVersion()) >= TITLE_KEY_VERSION) return null;
  const result = await rekeyLabels(opts);
  await db
    .insert(mirrorState)
    .values({ name: "title_keys", version: TITLE_KEY_VERSION })
    .onDuplicateKeyUpdate({ set: { version: TITLE_KEY_VERSION } });
  return result;
}
