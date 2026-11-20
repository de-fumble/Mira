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

/** Where an unfinished review stopped (it carries on from here). */
export type ReviewPlace = { stage: ReviewStage; done?: number; total?: number; about?: string };

/** One line of the analyze endpoint's NDJSON stream. */
export type ReviewEvent =
  | { type: "stage"; stage: ReviewStage; detail?: string; done?: number; total?: number }
  /**
   * The review is paused where it got to (the AI was busy or slow) and will
   * carry on by itself. If the stream ends on this line, ask again after
   * `retryInMs`; mid-stream it's only news — the server is still on it.
   */
  | ({ type: "waiting"; retryInMs: number } & ReviewPlace)
  | { type: "done"; analysis: DocAnalysis }
  /** Only for problems the writer can do something about (e.g. the document became too long). */
  | { type: "error"; error: string; status: number };
