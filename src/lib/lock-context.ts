import { createContext } from "react";

/** Whether the form is locked: a run is making its edits. */
export const LockedContext = createContext(false);
