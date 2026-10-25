/** A row of the Tracks section: its disc and row, by index. */
export interface RowAt {
  disc: number;
  row: number;
}

const EVENT = "discographer:go-to-track";

/** Asks the Tracks section to show a row: its disc's tab, scrolled to, with the focus on it. */
export function goToTrack(at: RowAt): void {
  window.dispatchEvent(new CustomEvent<RowAt>(EVENT, { detail: at }));
}

/** Calls `onGo` with each row `goToTrack` asks for, until the returned function is called. */
export function onGoToTrack(onGo: (at: RowAt) => void): () => void {
  const on = (e: Event) => onGo((e as CustomEvent<RowAt>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
