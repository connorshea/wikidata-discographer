import { createContext } from "react";

/** Whether the form is locked: a run is starting or making its edits. */
export const LockedContext = createContext(false);
