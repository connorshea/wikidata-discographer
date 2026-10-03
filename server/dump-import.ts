// Rebuild the music mirror from the Wikidata entity JSON dump.
//
// On Toolforge the weekly dump is on the read-only NFS mount at
//   /public/dumps/public/wikidatawiki/entities/latest-all.json.gz
// (one entity per line), visible to a job with `mount: all`. The file is
// streamed once:
//
//   0. Load every mirrored QID with the revision it was built from into
//      memory (`MirrorIndex`, ~13 bytes per item).
//   1. Inflate in ~1 MB chunks; only complete lines are handled.
//   2. Read the line's id and `lastrevid`, which sit at its start and end. An
//      item the mirror already has at that revision (or newer) is marked seen
//      and skipped: no filter, no parse, no write. Most weeks that's almost
//      every music item.
//   3. Cheap pre-filter on the raw bytes, in one pass over the line's
//      properties: keep it if it has a claim for one of the artist identifier
//      properties, or if a `"numeric-id":N` in its P31 claims is one of the
//      music classes (src/lib/music.ts CLASS_KINDS). Everything else is never
//      decoded or parsed.
//   4. Parse the kept lines and convert them with the same `entityToRow` the
//      app uses; an item whose best-rank P31 isn't a music class (and that has
//      no artist id) is dropped here.
//   5. Upsert the new and changed rows in batches, with their revids.
//   6. After a complete pass, delete the mirrored items that weren't seen
//      (gone from the dump, or no longer music), unless the app wrote them
//      after the dump was taken. Refuses to delete more than 20% of the mirror
//      unless forced.
//
// Rows written by an older MIRROR_VERSION (server/mirror.ts) are never
// skipped, so a change to what's extracted reaches every item on the next run.
//
// Everything is an idempotent upsert, so a job that dies is simply re-run.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import { and, asc, eq, gt, inArray, lt, notExists } from "drizzle-orm";
import { db, retryOnLockConflict } from "./db.ts";
import { musicExternalIds, musicItems } from "../db/schema.ts";
import { entityToRow, MIRROR_VERSION, type MirrorRow, upsertRows } from "./mirror.ts";
import type { Entity } from "./wikidata-client.ts";
import { ARTIST_ID_PROPERTIES, CLASS_KINDS } from "../src/lib/music.ts";

export const DEFAULT_DUMP_PATH = "/public/dumps/public/wikidatawiki/entities/latest-all.json.gz";

const NL = 0x0a;
const NUMERIC_ID = Buffer.from('"numeric-id":');
const CLASS_NUMBERS = new Set(CLASS_KINDS.map(([qid]) => Number(qid.slice(1))));
// Claims are keyed by property, and each property's first statement opens its
// list: `"claims":{"P31":[{"mainsnak":…},{"mainsnak":…}],"P434":[{"mainsnak":…`.
// Qualifiers and references are lists of bare snaks (`"P580":[{"snaktype"…`),
// so this marks the claims alone, once per property.
const CLAIM_LIST = Buffer.from('":[{"mainsnak":');
const ARTIST_NUMBERS = new Set(ARTIST_ID_PROPERTIES.map((p) => Number(p.slice(1))));
const P = 0x50;
const QUOTE = 0x22;
const BATCH_SIZE = 1000;
const MAX_PRUNE_SHARE = 0.2;
// Pruned in chunks so a big prune reports progress and holds no long lock.
const PRUNE_CHUNK = 5000;
const LOAD_PAGE = 50_000;
const ID_KEY = Buffer.from('"id":"Q');
const LASTREVID_KEY = Buffer.from('"lastrevid":');
// `{"type":"item","id":"Q…` — the id is the second key.
const HEADER_BYTES = 64;
// `…,"lastrevid":2548173641,"modified":"2026-09-21T16:13:48Z"},`
const TRAILER_BYTES = 256;

/**
 * An item line's QID number and `lastrevid`, read from where the dump puts
 * them (its start and end) without parsing; null for anything else. Nested
 * values hold `"id":"Q…"` too, hence only the first bytes are searched.
 */
export function readHeader(line: Buffer): { qid: number; revid: number } | null {
  const at = line.subarray(0, HEADER_BYTES).indexOf(ID_KEY);
  if (at === -1) return null;
  let qid = 0;
  let i = at + ID_KEY.length;
  for (; i < line.length && line[i] >= 0x30 && line[i] <= 0x39; i++)
    qid = qid * 10 + (line[i] - 0x30);
  if (i === at + ID_KEY.length || line[i] !== QUOTE) return null;
  const tail = Math.max(0, line.length - TRAILER_BYTES);
  const r = line.subarray(tail).lastIndexOf(LASTREVID_KEY);
  if (r === -1) return null;
  let revid = 0;
  let j = tail + r + LASTREVID_KEY.length;
  const digits = j;
  for (; j < line.length && line[j] >= 0x30 && line[j] <= 0x39; j++)
    revid = revid * 10 + (line[j] - 0x30);
  return j === digits ? null : { qid, revid };
}

/**
 * The mirror's QIDs and the revision each row was built from, as sorted typed
 * arrays (a JS Map of millions of entries would cost several times as much),
 * plus which ones this pass has seen.
 */
export class MirrorIndex {
  readonly qids: Uint32Array;
  /** -1 for a row that must be re-read (unknown revid, or an older MIRROR_VERSION). */
  readonly revids: Float64Array;
  readonly seen: Uint8Array;

  constructor(rows: Iterable<{ qid: string; revid: number | null; rowVersion: number }>) {
    let qids = new Uint32Array(1024);
    let revids = new Float64Array(1024);
    let n = 0;
    for (const r of rows) {
      if (!/^Q\d+$/.test(r.qid)) continue;
      if (n === qids.length) {
        const grown = new Uint32Array(n * 2);
        grown.set(qids);
        qids = grown;
        const grownRevids = new Float64Array(n * 2);
        grownRevids.set(revids);
        revids = grownRevids;
      }
      qids[n] = Number(r.qid.slice(1));
      revids[n] = r.revid != null && r.rowVersion >= MIRROR_VERSION ? r.revid : -1;
      n++;
    }
    // Sort by QID number; rows were read in string order (Q10 < Q9).
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => qids[a] - qids[b]);
    this.qids = new Uint32Array(n);
    this.revids = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.qids[i] = qids[order[i]];
      this.revids[i] = revids[order[i]];
    }
    this.seen = new Uint8Array(n);
  }

  get size(): number {
    return this.qids.length;
  }

  /** The position of QID number `qid`, or -1. */
  find(qid: number): number {
    let lo = 0;
    let hi = this.qids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.qids[mid];
      if (v === qid) return mid;
      if (v < qid) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Whether the row at `i` is already built from revision `revid` or a later one. */
  isCurrent(i: number, revid: number): boolean {
    return this.revids[i] >= revid;
  }

  /** The QIDs this pass hasn't seen. */
  unseen(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.seen.length; i++) if (!this.seen[i]) out.push(`Q${this.qids[i]}`);
    return out;
  }

  /** Read the whole mirror, a page at a time. */
  static async load(): Promise<MirrorIndex> {
    const rows: { qid: string; revid: number | null; rowVersion: number }[][] = [];
    let after = "";
    for (;;) {
      const page = await db
        .select({ qid: musicItems.qid, revid: musicItems.revid, rowVersion: musicItems.rowVersion })
        .from(musicItems)
        .where(gt(musicItems.qid, after))
        .orderBy(asc(musicItems.qid))
        .limit(LOAD_PAGE);
      if (page.length === 0) break;
      rows.push(page);
      after = page[page.length - 1].qid;
    }
    return new MirrorIndex(rows.flat());
  }
}

/**
 * Whether a dump line might be a music item (false positives are fine, misses
 * aren't). Hot: runs on every line of the dump, so it visits each claimed
 * property once and only reads numbers inside the P31 claims.
 */
export function mightMatch(line: Buffer): boolean {
  for (let i = line.indexOf(CLAIM_LIST); i !== -1;) {
    // Read the property number backwards from `"P434` + `":[{"mainsnak":`.
    let j = i - 1;
    let prop = 0;
    for (let place = 1; j >= 0 && line[j] >= 0x30 && line[j] <= 0x39; j--, place *= 10)
      prop += (line[j] - 0x30) * place;
    const next = line.indexOf(CLAIM_LIST, i + CLAIM_LIST.length);
    if (j > 0 && line[j] === P && line[j - 1] === QUOTE) {
      if (ARTIST_NUMBERS.has(prop)) return true;
      if (prop === 31 && hasClass(line, i, next === -1 ? line.length : next)) return true;
    }
    i = next;
  }
  return false;
}

/** Whether a `"numeric-id":N` in `line[from, to)` is a music class. */
function hasClass(line: Buffer, from: number, to: number): boolean {
  for (let i = line.indexOf(NUMERIC_ID, from); i !== -1 && i < to;) {
    let j = i + NUMERIC_ID.length;
    let n = 0;
    while (j < line.length && line[j] >= 0x30 && line[j] <= 0x39) n = n * 10 + (line[j++] - 0x30);
    if (CLASS_NUMBERS.has(n)) return true;
    i = line.indexOf(NUMERIC_ID, j);
  }
  return false;
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

/** The process's memory use, for the progress lines: RSS (what the job's
 * memory limit counts), the V8 heap (capped by --max-old-space-size), and
 * external memory, which includes the Buffers holding the inflated dump. */
export function memoryNote(mem: NodeJS.MemoryUsage = process.memoryUsage()): string {
  const mb = (n: number) => Math.round(n / 1e6);
  return (
    ` [rss ${mb(mem.rss)} MB, heap ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB, ` +
    `external ${mb(mem.external)} MB (buffers ${mb(mem.arrayBuffers)} MB)]`
  );
}

/**
 * A progress line for the log. Progress is measured on the compressed file
 * (bytes read of its size); the ETA assumes the rest goes at the average rate
 * so far. The MB/s is the average rate over the inflated JSON.
 */
export function progressLine(
  stats: Pick<ImportStats, "bytes" | "lines" | "unchanged" | "matched">,
  read: number,
  size: number,
  elapsedMs: number,
): string {
  const rate = elapsedMs > 0 ? ` at ${Math.round(stats.bytes / 1e3 / elapsedMs)} MB/s` : "";
  const counts =
    `${(stats.bytes / 1e9).toFixed(1)} GB${rate}, ${stats.lines} lines, ` +
    `${stats.unchanged} unchanged, ${stats.matched} new or changed`;
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
  /** Mirrored items the dump has at the same revision, skipped unparsed. */
  unchanged: number;
  parsed: number;
  /** New and changed music items written. */
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
    unchanged: 0,
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
    await upsertRows(rows, { source: "dump" });
  };

  const loadStarted = Date.now();
  const index = await MirrorIndex.load();
  const current = index.revids.reduce((n, r) => n + (r >= 0 ? 1 : 0), 0);
  console.log(
    `import-dump: loaded ${index.size} mirrored items (${current} skippable at their revision) ` +
      `in ${formatDuration(Date.now() - loadStarted)}` +
      memoryNote(),
  );

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
      const header = readHeader(line);
      const at = header ? index.find(header.qid) : -1;
      if (at !== -1 && index.isCurrent(at, header!.revid)) {
        index.seen[at] = 1;
        stats.unchanged++;
        continue;
      }
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
      if (at !== -1) index.seen[at] = 1;
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
      console.log(progressLine(stats, file.bytesRead, size, lastLog - started) + memoryNote());
    }
  }
  if (stats.stopped) file.destroy();
  await flush();

  if (!stats.stopped && opts.prune !== false)
    stats.pruned = await prune(index, stats.stamp, !!opts.forcePrune);
  stats.seconds = (Date.now() - started) / 1000;
  return stats;
}

/**
 * Delete the mirrored items a complete pass of dump `stamp` didn't see, except
 * those the app wrote after the dump was taken (created or edited since).
 */
async function prune(index: MirrorIndex, stamp: string, force: boolean): Promise<number> {
  const dumpTaken = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} 00:00:00`;
  const unseen = index.unseen();
  const n = unseen.length;
  const total = index.size;
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
  console.log(`import-dump: pruning up to ${n} of ${total} items not in dump ${stamp}`);
  const started = Date.now();
  let lastLog = started;
  let pruned = 0;
  for (let i = 0; i < n; i += PRUNE_CHUNK) {
    const qids = unseen.slice(i, i + PRUNE_CHUNK);
    pruned += await retryOnLockConflict("import-dump: prune", () =>
      db.transaction(async (tx) => {
        const [res] = await tx
          .delete(musicItems)
          .where(and(inArray(musicItems.qid, qids), lt(musicItems.updatedAt, dumpTaken)));
        const deleted = res.affectedRows;
        await tx
          .delete(musicExternalIds)
          .where(
            and(
              inArray(musicExternalIds.qid, qids),
              notExists(
                tx.select().from(musicItems).where(eq(musicItems.qid, musicExternalIds.qid)),
              ),
            ),
          );
        return deleted;
      }),
    );
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      console.log(pruneProgressLine(i + qids.length, n, lastLog - started) + memoryNote());
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
