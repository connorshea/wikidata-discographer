import type { Plan, State } from "../lib/plan.ts";

/** Apply a change to a copy of the form state. */
export type Update = (fn: (draft: State) => void) => void;

export interface SectionProps {
  state: State;
  update: Update;
  plan: Plan;
}
