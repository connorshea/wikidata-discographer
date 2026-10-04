// Spaces out the Wikidata writes this server makes, so a run's edits go out at
// a steady pace rather than in a burst. Each write waits for its turn:
//
//   - per user: `createGapMs` after the user's last write before a create,
//     `editGapMs` before any other write. The time is kept across runs, so a
//     run started right after another doesn't burst either.
//   - across the server: `serverGapMs` after anyone's last write, so runs by
//     different users don't add up to one.
//
// Gaps are measured from when each write was let go, like the MusicBrainz
// client's slots (server/musicbrainz.ts). Reads aren't paced. The state lives
// in this process: a restart forgets it, which costs at most one gap.

export type WriteKind = "create" | "edit";

export interface PaceDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  createGapMs: number;
  editGapMs: number;
  serverGapMs: number;
}

/** A gap from the environment, or `fallback` when it's unset or not a number. */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const defaultDeps = (): PaceDeps => ({
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  createGapMs: envMs("WIKIDATA_CREATE_GAP_MS", 2000),
  editGapMs: envMs("WIKIDATA_EDIT_GAP_MS", 1000),
  serverGapMs: envMs("WIKIDATA_SERVER_GAP_MS", 1000),
});

export interface EditPacer {
  /** Wait until `userId` may make a write of this kind, and take that turn. */
  waitTurn(userId: number, kind: WriteKind): Promise<void>;
  /** When `userId`'s turn that is being waited for comes, if one is. */
  waitingUntil(userId: number): number | null;
}

export function createEditPacer(overrides: Partial<PaceDeps> = {}): EditPacer {
  const deps = { ...defaultDeps(), ...overrides };
  // When each user, and anyone, last took a turn (possibly in the future,
  // for a turn being waited for).
  const lastByUser = new Map<number, number>();
  let lastAny = -Infinity;
  const waiting = new Map<number, number>();

  return {
    async waitTurn(userId, kind) {
      const now = deps.now();
      const gap = kind === "create" ? deps.createGapMs : deps.editGapMs;
      const slot = Math.max(
        now,
        (lastByUser.get(userId) ?? -Infinity) + gap,
        lastAny + deps.serverGapMs,
      );
      lastByUser.set(userId, slot);
      lastAny = slot;
      if (slot <= now) return;
      waiting.set(userId, slot);
      try {
        await deps.sleep(slot - now);
      } finally {
        if (waiting.get(userId) === slot) waiting.delete(userId);
      }
    },
    waitingUntil: (userId) => waiting.get(userId) ?? null,
  };
}

/** The pacer every write to Wikidata goes through. */
export const editPacer = createEditPacer();
