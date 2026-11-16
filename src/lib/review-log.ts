import "server-only";
import { ISSUE_TYPES, type IssueType } from "./documents";
import { ReviewBusyError, ReviewError, ReviewUnavailableError, type Attempt, type ReviewMeta } from "./proofread";
import { createAdminClient } from "./supabase/admin";

export type ReviewOutcome = "ok" | "busy" | "failed" | "unavailable";

export type ReviewRunInput = {
  userId: string | null;
  documentId: string | null;
  isTest?: boolean;
  words: number;
  durationMs: number;
} & (
  | { meta: ReviewMeta; issues: { type: IssueType }[]; score: number | null }
  | { error: unknown }
);

export function outcomeOf(err: unknown): ReviewOutcome {
  if (err instanceof ReviewUnavailableError) return "unavailable";
  if (err instanceof ReviewBusyError) return "busy";
  return "failed";
}

/**
 * Records one review for the admin dashboard (numbers only — never the text).
 * Never throws: monitoring must not break a review.
 */
export async function logReview(run: ReviewRunInput) {
  const base = {
    user_id: run.userId,
    document_id: run.documentId,
    is_test: run.isTest ?? false,
    words: run.words,
    duration_ms: Math.round(run.durationMs),
  };
  let row: Record<string, unknown>;
  if ("meta" in run) {
    const types = Object.fromEntries(Object.keys(ISSUE_TYPES).map((t) => [t, 0])) as Record<IssueType, number>;
    for (const i of run.issues) types[i.type] = (types[i.type] ?? 0) + 1;
    row = {
      ...base,
      outcome: "ok",
      model: run.meta.model,
      attempts: run.meta.attempts,
      issues: run.issues.length,
      issue_types: types,
      score: run.score,
      input_tokens: run.meta.usage.input,
      output_tokens: run.meta.usage.output,
      thinking_tokens: run.meta.usage.thinking,
    };
  } else {
    const attempts: Attempt[] = run.error instanceof ReviewError ? run.error.attempts : [];
    row = {
      ...base,
      outcome: outcomeOf(run.error),
      attempts,
      error: (run.error instanceof Error ? run.error.message : String(run.error)).slice(0, 500),
    };
  }
  try {
    const { error } = await createAdminClient().from("review_runs").insert(row);
    if (error) console.warn("Review log not saved:", error.message);
  } catch (e) {
    console.warn("Review log not saved:", e);
  }
}
