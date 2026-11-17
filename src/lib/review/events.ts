// Shared by the review pipeline (server) and the review panel (browser):
// the stages a review goes through, and the progress messages it streams.

import type { DocAnalysis } from "../documents";

export type ReviewStage = "read" | "understand" | "check" | "verify";

/** What the writer sees while a review runs, in order. */
export const REVIEW_STEPS: { stage: ReviewStage; label: string }[] = [
  { stage: "read", label: "Reading the document" },
  { stage: "understand", label: "Working out what it’s about" },
  { stage: "check", label: "Checking every sentence" },
  { stage: "verify", label: "Double-checking each flag" },
];

/** One line of the analyze endpoint's NDJSON stream. */
export type ReviewEvent =
  | { type: "stage"; stage: ReviewStage; detail?: string; done?: number; total?: number }
  | { type: "done"; analysis: DocAnalysis }
  | { type: "error"; error: string; status: number };
