// The tracks this app's runs created for an album. They may already be on its
// tracklist without blocking a run: a run that failed after adding the
// tracklist (the singles come after it) is started again with them in the form.
// Any other track on the tracklist blocks it, even one the form reuses, such
// as a track a MusicBrainz import found by its recording ID.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { qidNumber, toQid } from "./ids.ts";
import { submissions, wikidataEdits } from "../db/schema.ts";

/** Which of `tracks` a run of this app created with `album` as its album. */
export async function tracksMadeFor(album: string, tracks: readonly string[]): Promise<string[]> {
  if (!tracks.length) return [];
  const rows = await db
    .selectDistinct({ qid: wikidataEdits.qid })
    .from(wikidataEdits)
    .innerJoin(submissions, eq(submissions.id, wikidataEdits.submissionId))
    .where(
      and(
        eq(submissions.albumQid, qidNumber(album)),
        eq(wikidataEdits.op, "create"),
        eq(wikidataEdits.kind, "track"),
        eq(wikidataEdits.ok, true),
        inArray(wikidataEdits.qid, tracks.map(qidNumber)),
      ),
    );
  return rows.flatMap((r) => (r.qid == null ? [] : [toQid(r.qid)]));
}
