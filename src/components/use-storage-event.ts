import { useEffect, useRef } from "react";

/**
 * Call `onChange` with the new value (null once removed) whenever another tab
 * changes `key` in localStorage. The browser doesn't tell the tab that made
 * the change, so a tab can adopt the value without writing it back.
 */
export function useStorageEvent(key: string, onChange: (value: string | null) => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  useEffect(() => {
    const listener = (e: StorageEvent) => {
      // A null key: the other tab cleared all of storage.
      if (e.key === key || e.key === null) latest.current(e.key === null ? null : e.newValue);
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [key]);
}
