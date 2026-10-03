// The database stores item and property IDs as numbers (Q123 → 123, P175 →
// 175); everything else (the plan, the API, the client, Wikidata) uses the
// strings. These convert at the database boundary.

/** "Q123" → 123. Throws on anything that isn't an item ID. */
export function qidNumber(qid: string): number {
  const m = /^Q(\d+)$/.exec(qid);
  if (!m) throw new Error(`Not an item ID: ${JSON.stringify(qid)}`);
  return Number(m[1]);
}

/** 123 → "Q123". */
export const toQid = (n: number): string => `Q${n}`;

/** "P175" → 175. Throws on anything that isn't a property ID. */
export function propertyNumber(pid: string): number {
  const m = /^P(\d+)$/.exec(pid);
  if (!m) throw new Error(`Not a property ID: ${JSON.stringify(pid)}`);
  return Number(m[1]);
}

/** 175 → "P175". */
export const toProperty = (n: number): string => `P${n}`;
