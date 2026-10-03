// The local mirror of Wikidata music items (`music_items`,
// `music_external_ids` and `music_links`): converting an entity to a row, and writing rows. Used
// by the weekly dump import, by runs (each created item is added straight
// away), and by "add an item" for things created since the last dump.
import { inArray, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { musicExternalIds, musicItems, musicLinks } from "../db/schema.ts";
import { ID_PROPERTIES, kindOf, LINK_PROPERTIES, type MusicKind } from "../src/lib/music.ts";
import type { Entity, WikibaseStatement } from "./wikidata-client.ts";

export interface MirrorRow {
  qid: string;
  kind: MusicKind;
  label: string | null;
  description: string | null;
  instanceOf: string[];
  ids: { property: string; value: string }[];
  links: { property: string; target: string }[];
}

/** Most links kept per property, so one huge tracklist can't bloat the table. */
const MAX_LINKS_PER_PROPERTY = 200;

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
    .filter((id): id is string => typeof id === "string");
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
  if (kind !== "artist")
    for (const property of Object.keys(LINK_PROPERTIES)) {
      const targets = new Set<string>();
      for (const s of claims[property] ?? []) {
        const id = (s.mainsnak.datavalue?.value as { id?: unknown } | undefined)?.id;
        if (s.rank !== "deprecated" && typeof id === "string" && /^Q\d+$/.test(id)) targets.add(id);
      }
      for (const target of [...targets].slice(0, MAX_LINKS_PER_PROPERTY))
        links.push({ property, target });
    }
  const label = pickText(entity.labels);
  return {
    qid: entity.id,
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
 * Insert or update rows and make their external ids and links match. `lastDump` stamps
 * them as seen in that dump; the app's own writes pass null and keep whatever
 * stamp the row had.
 */
export async function upsertRows(
  rows: readonly MirrorRow[],
  opts: { lastDump: string | null; source: "dump" | "app" },
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => ({
    qid: r.qid,
    kind: r.kind,
    label: r.label,
    labelSearch: labelSearchKey(r.label),
    description: r.description,
    instanceOf: r.instanceOf,
    lastDump: opts.lastDump,
    source: opts.source,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }));
  const qids = rows.map((r) => r.qid);
  const ids = rows.flatMap((r) => r.ids.map((id) => ({ qid: r.qid, ...id })));
  const links = rows.flatMap((r) => r.links.map((l) => ({ qid: r.qid, ...l })));
  await db.transaction(async (tx) => {
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
          lastDump: opts.lastDump === null ? sql`last_dump` : sql`values(last_dump)`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
    await tx.delete(musicExternalIds).where(inArray(musicExternalIds.qid, qids));
    if (ids.length) await tx.insert(musicExternalIds).values(ids);
    await tx.delete(musicLinks).where(inArray(musicLinks.qid, qids));
    if (links.length) await tx.insert(musicLinks).values(links);
  });
}
