// Rebuild the music mirror from the Wikidata entity JSON dump.
//
// On Toolforge the weekly dump is on the read-only NFS mount at
//   /public/dumps/public/wikidatawiki/entities/latest-all.json.gz
// (one entity per line), visible to a job with `mount: all`. The file is
// streamed once:
//
//   1. Inflate in ~1 MB chunks; only complete lines are handled.
//   2. Cheap pre-filter on the raw bytes: keep a line if a `"numeric-id":N`
//      in it is one of the music classes (src/lib/music.ts CLASS_KINDS), or if
//      it has a claim for one of the artist identifier properties. Everything
//      else is never decoded or parsed.
//   3. Parse the kept lines and convert them with the same `entityToRow` the
//      app uses; an item whose best-rank P31 isn't a music class (and that has
//      no artist id) is dropped here.
//   4. Upsert in batches, stamping each row with the dump's date.
//   5. After a complete pass, delete rows the dump no longer has: dump rows
//      stamped with an older dump, and app-added rows from before the dump
//      was taken. Refuses to delete more than 20% of the mirror unless forced.
//
// Everything is an idempotent upsert, so a job that dies is simply re-run.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import { and, count, eq, inArray, isNotNull, isNull, lt, ne, notExists, or } from "drizzle-orm";
import { db } from "./db.ts";
import { musicExternalIds, musicItems } from "../db/schema.ts";
import { entityToRow, type MirrorRow, upsertRows } from "./mirror.ts";
import type { Entity } from "./wikidata-client.ts";
import { ARTIST_ID_PROPERTIES, CLASS_KINDS } from "../src/lib/music.ts";

export const DEFAULT_DUMP_PATH = "/public/dumps/public/wikidatawiki/entities/latest-all.json.gz";

const NL = 0x0a;
const NUMERIC_ID = Buffer.from('"numeric-id":');
const CLASS_NUMBERS = new Set(CLASS_KINDS.map(([qid]) => Number(qid.slice(1))));
// Claims are keyed by property: `"claims":{…,"P434":[{"mainsnak":…`.
const ARTIST_NEEDLES = ARTIST_ID_PROPERTIES.map((p) => Buffer.from(`"${p}":[`));
const BATCH_SIZE = 1000;
const MAX_PRUNE_SHARE = 0.2;
// Pruned in chunks so a big prune reports progress and holds no long lock.
const PRUNE_CHUNK = 5000;

/** Whether a dump line might be a music item (false positives are fine, misses aren't). */
export function mightMatch(line: Buffer): boolean {
  let i = line.indexOf(NUMERIC_ID);
  while (i !== -1) {
    let j = i + NUMERIC_ID.length;
    let n = 0;
    while (j < line.length && line[j] >= 0x30 && line[j] <= 0x39) n = n * 10 + (line[j++] - 0x30);
    if (CLASS_NUMBERS.has(n)) return true;
    i = line.indexOf(NUMERIC_ID, j);
  }
  return ARTIST_NEEDLES.some((needle) => line.includes(needle));
}

/** Parse one dump line (`{…},` or the `[` / `]` brackets) into an entity, or null. */
export function parseLine(line: Buffer): Entity | null {
  let end = line.length;
  while (end > 0 && (line[end - 1] === 0x2c || line[end - 1] === 0x0d || line[end - 1] === 0x20))
    end--;
  if (end < 2 || line[0] !== 0x7b) return null;
  return JSON.parse(line.toString("utf8", 0, end)) as Entity;
}

/** The dump's date from its file name (`wikidata-20260930-all.json.gz` → "20260930"). */
export function dumpStamp(path: string, now = new Date()): string {
  return /(\d{8})/.exec(basename(path))?.[1] ?? now.toISOString().slice(0, 10).replace(/-/g, "");
}

/** "2h 05m", "14m", "<1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return "<1m";
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`;
}

/**
 * A progress line for the log. Progress is measured on the compressed file
 * (bytes read of its size); the ETA assumes the rest goes at the average rate
 * so far.
 */
export function progressLine(
  stats: Pick<ImportStats, "bytes" | "lines" | "matched">,
  read: number,
  size: number,
  elapsedMs: number,
): string {
  const counts = `${(stats.bytes / 1e9).toFixed(1)} GB, ${stats.lines} lines, ${stats.matched} matched`;
  if (!(size > 0 && read > 0)) return `import-dump: ${counts}`;
  const done = Math.min(read / size, 1);
  const eta = (elapsedMs * (1 - done)) / done;
  return `import-dump: ${(done * 100).toFixed(1)}%, ETA ${formatDuration(eta)} — ${counts}`;
}

export interface ImportOptions {
  path: string;
  /** Stop after this many matched items (timing runs); disables pruning. */
  limit?: number;
  prune?: boolean;
  forcePrune?: boolean;
}

export interface ImportStats {
  stamp: string;
  bytes: number;
  lines: number;
  parsed: number;
  matched: number;
  skipped: number;
  pruned: number;
  stopped: boolean;
  seconds: number;
}

export async function runDumpImport(opts: ImportOptions): Promise<ImportStats> {
  const started = Date.now();
  const stats: ImportStats = {
    // latest-all.json.gz is a symlink; the dated name is on its target.
    stamp: dumpStamp(await realpath(opts.path)),
    bytes: 0,
    lines: 0,
    parsed: 0,
    matched: 0,
    skipped: 0,
    pruned: 0,
    stopped: false,
    seconds: 0,
  };
  let batch: MirrorRow[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    await upsertRows(rows, { lastDump: stats.stamp, source: "dump" });
  };

  const size = (await stat(opts.path)).size;
  const file = createReadStream(opts.path, { highWaterMark: 1 << 20 });
  const input: Readable = opts.path.endsWith(".gz")
    ? file.pipe(createGunzip({ chunkSize: 1 << 20 }))
    : file;
  let carry: Buffer | null = null;
  let lastLog = Date.now();

  outer: for await (const chunk of input as AsyncIterable<Buffer>) {
    stats.bytes += chunk.length;
    const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let nl = buf.indexOf(NL, start); nl !== -1; nl = buf.indexOf(NL, start)) {
      const line = buf.subarray(start, nl);
      start = nl + 1;
      stats.lines++;
      if (!mightMatch(line)) continue;
      stats.parsed++;
      let row: MirrorRow | null;
      try {
        const entity = parseLine(line);
        row = entity ? entityToRow(entity) : null;
      } catch (err) {
        stats.skipped++;
        if (stats.skipped <= 20)
          console.warn(`import-dump: skipping unreadable line ${stats.lines}`, err);
        continue;
      }
      if (!row) continue;
      stats.matched++;
      batch.push(row);
      if (batch.length >= BATCH_SIZE) await flush();
      if (opts.limit && stats.matched >= opts.limit) {
        stats.stopped = true;
        break outer;
      }
    }
    // Copy the partial last line: `chunk` is reused by the stream.
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      console.log(progressLine(stats, file.bytesRead, size, lastLog - started));
    }
  }
  if (stats.stopped) file.destroy();
  await flush();

  if (!stats.stopped && opts.prune !== false)
    stats.pruned = await prune(stats.stamp, !!opts.forcePrune);
  stats.seconds = (Date.now() - started) / 1000;
  return stats;
}

/** Delete the rows a complete pass of dump `stamp` didn't see. */
async function prune(stamp: string, force: boolean): Promise<number> {
  const dumpTaken = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} 00:00:00`;
  const stale = or(
    and(isNotNull(musicItems.lastDump), ne(musicItems.lastDump, stamp)),
    // Added by the app before the dump was taken, yet not in it: deleted,
    // merged or retyped since.
    and(isNull(musicItems.lastDump), lt(musicItems.updatedAt, dumpTaken)),
  );
  const [{ total }] = await db.select({ total: count() }).from(musicItems);
  const [{ n }] = await db.select({ n: count() }).from(musicItems).where(stale);
  if (n === 0) {
    console.log("import-dump: nothing to prune");
    return 0;
  }
  if (!force && n > total * MAX_PRUNE_SHARE) {
    console.warn(
      `import-dump: not pruning ${n} of ${total} items (over ${MAX_PRUNE_SHARE * 100}%); ` +
        "rerun with DUMP_PRUNE_FORCE=1 if that's expected",
    );
    return 0;
  }
  console.log(`import-dump: pruning ${n} of ${total} items not in dump ${stamp}`);
  const started = Date.now();
  let lastLog = started;
  let pruned = 0;
  for (;;) {
    const qids = (
      await db.select({ qid: musicItems.qid }).from(musicItems).where(stale).limit(PRUNE_CHUNK)
    ).map((r) => r.qid);
    if (qids.length === 0) break;
    await db.transaction(async (tx) => {
      // Recheck `stale`: the app may have refreshed an item since the select.
      const [res] = await tx.delete(musicItems).where(and(inArray(musicItems.qid, qids), stale));
      pruned += res.affectedRows;
      await tx
        .delete(musicExternalIds)
        .where(
          and(
            inArray(musicExternalIds.qid, qids),
            notExists(tx.select().from(musicItems).where(eq(musicItems.qid, musicExternalIds.qid))),
          ),
        );
    });
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      console.log(pruneProgressLine(pruned, n, lastLog - started));
    }
  }
  console.log(`import-dump: pruned ${pruned} items in ${formatDuration(Date.now() - started)}`);
  return pruned;
}

export function pruneProgressLine(pruned: number, total: number, elapsedMs: number): string {
  const done = Math.min(pruned / total, 1);
  const eta = done > 0 ? `, ETA ${formatDuration((elapsedMs * (1 - done)) / done)}` : "";
  return `import-dump: pruned ${pruned} of ${total} (${(done * 100).toFixed(1)}%${eta})`;
}
