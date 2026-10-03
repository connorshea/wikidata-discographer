// The local mirror of Wikidata music items (`music_items`,
// `music_external_ids` and `music_links`): converting an entity to a row, and writing rows. Used
// by the weekly dump import, by runs (each created item is added straight
// away), and by "add an item" for things created since the last dump.
import { inArray, sql } from "drizzle-orm";
import { db, retryOnLockConflict } from "./db.ts";
import { propertyNumber, qidNumber } from "./ids.ts";
import { musicExternalIds, musicItems, musicLinks } from "../db/schema.ts";
import { ID_PROPERTIES, kindOf, LINK_PROPERTIES, type MusicKind } from "../src/lib/music.ts";
import type { Entity, WikibaseStatement } from "./wikidata-client.ts";

/**
 * The version of what `entityToRow` extracts. The dump import skips items
 * whose revision it has already mirrored, so bump this whenever the row's
 * contents change (a new column, a class added or removed): rows from an
 * older version are then re-read from the next dump.
 */
export const MIRROR_VERSION = 2; // 2: music_links, and curly quotes in label_search

export interface MirrorRow {
  qid: string;
  /** The revision the row was built from, if known. */
  revid: number | null;
  kind: MusicKind;
  label: string | null;
  description: string | null;
  instanceOf: string[];
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
    ids,
    links,
  };
}

/**
 * The key a label is searched and matched by: lowercased, with curly quotes
 * made straight (tracklists and Wikidata labels use either), clipped to the
 * index length.
 */
export const labelSearchKey = (label: string | null | undefined) =>
  label
    ? Array.from(
        label
          .normalize("NFC")
          .toLowerCase()
          .replace(/[’‘]/g, "'")
          .replace(/[“”]/g, '"'),
      )
        .slice(0, 191)
        .join("")
    : null;

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
