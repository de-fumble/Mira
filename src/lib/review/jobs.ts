import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewPlace } from "./events";
import { ReviewUnavailableError } from "./gemini";
import type { ReviewCheckpoint } from "./pipeline";

/*
 * Reviews that are still going (supabase/migrations/0007_review_jobs.sql).
 * When the AI is busy or slow, a review is paused where it got to and tried
 * again a little later, until it finishes — the writer never sees an error for
 * it. Without the migration, reviews still retry; they just can't keep their
 * place between visits.
 */

/** What's saved for an unfinished review: its checkpoint and where it stopped. */
export type ReviewJobState = ReviewCheckpoint & { place?: ReviewPlace };

export type ReviewJob = {
  document_id: string;
  lease_until: string | null;
  next_at: string;
  rounds: number;
  state: ReviewJobState;
  created_at: string;
};

/** A run may work on a job for this long before another may take over (the analyze route runs for at most 300 s). */
export const LEASE_SECONDS = 310;

let warned = false;
const untracked = (error: { message: string }) => {
  if (!warned) console.warn("Review jobs aren’t saved (run supabase/migrations/0007_review_jobs.sql):", error.message);
  warned = true;
};

/** The saved job for a document, if any. `null` too when the table isn't set up. */
export async function readReviewJob(supabase: SupabaseClient, documentId: string): Promise<ReviewJob | null> {
  const { data, error } = await supabase.from("review_jobs").select("*").eq("document_id", documentId).maybeSingle<ReviewJob>();
  if (error) untracked(error);
  return data ?? null;
}

/** Ids of the documents (of the signed-in user) with a review still going. */
export async function pendingReviewIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("review_jobs").select("document_id").limit(200);
  if (error) {
    untracked(error);
    return [];
  }
  return (data ?? []).map((r: { document_id: string }) => r.document_id);
}

export type Claim =
  /** This run has the job (new or picked up where it stopped). */
  | { status: "claimed"; job: ReviewJob }
  /** Another run is working on it. */
  | { status: "held"; job: ReviewJob | null }
  /** Jobs can't be saved (migration 0007 not run): review without keeping the place. */
  | { status: "untracked" };

export async function claimReviewJob(supabase: SupabaseClient, documentId: string): Promise<Claim> {
  const { data, error } = await supabase.rpc("claim_review_job", { doc: documentId, lease_seconds: LEASE_SECONDS });
  if (error) {
    untracked(error);
    return { status: "untracked" };
  }
  const job = (data as ReviewJob[] | null)?.[0];
  if (job) return { status: "claimed", job: { ...job, state: job.state ?? {} } };
  return { status: "held", job: await readReviewJob(supabase, documentId) };
}

/** Saves progress (never throws: a lost save only means a part is checked again). */
export async function saveReviewJob(
  supabase: SupabaseClient,
  documentId: string,
  patch: Partial<Pick<ReviewJob, "state" | "rounds" | "next_at" | "lease_until">>,
) {
  try {
    const { error } = await supabase
      .from("review_jobs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("document_id", documentId);
    if (error) console.warn("Review progress not saved:", error.message);
  } catch (e) {
    console.warn("Review progress not saved:", e);
  }
}

/** The review finished: nothing left to carry on with. */
export async function finishReviewJob(supabase: SupabaseClient, documentId: string) {
  try {
    const { error } = await supabase.from("review_jobs").delete().eq("document_id", documentId);
    if (error) console.warn("Finished review job not removed:", error.message);
  } catch (e) {
    console.warn("Finished review job not removed:", e);
  }
}

/**
 * How long to wait before trying again after the `rounds`-th time a review
 * couldn't finish: quickly at first (a model is often busy for seconds), then
 * less often. A missing or rejected key waits longest — someone has to fix it.
 */
export function retryDelayMs(rounds: number, err: unknown): number {
  if (err instanceof ReviewUnavailableError) return 10 * 60_000;
  const steps = [10, 20, 40, 60, 120, 300];
  const base = steps[Math.min(Math.max(rounds, 1), steps.length) - 1] * 1000;
  return Math.round(base * (0.85 + Math.random() * 0.3)); // spread out, so retries don't arrive together
}

/* ------------------------------------------------------------------ */
/* For the scheduler (/api/cron/reviews), with the secret-key client     */
/* ------------------------------------------------------------------ */

/** Reviews due another try that no run is working on, oldest first. */
export async function dueReviewJobs(admin: SupabaseClient, limit: number): Promise<{ document_id: string }[]> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("review_jobs")
    .select("document_id")
    .lte("next_at", now)
    .or(`lease_until.is.null,lease_until.lt."${now}"`)
    .order("next_at")
    .limit(limit);
  if (error) {
    untracked(error);
    return [];
  }
  return data ?? [];
}

/** Takes one due review for the scheduler; null if a run got to it first. */
export async function claimDueReviewJob(admin: SupabaseClient, documentId: string): Promise<(ReviewJob & { user_id: string }) | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("review_jobs")
    .update({ lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), updated_at: now })
    .eq("document_id", documentId)
    .or(`lease_until.is.null,lease_until.lt."${now}"`)
    .select("*")
    .maybeSingle<ReviewJob & { user_id: string }>();
  if (error) console.warn("Review job not claimed:", error.message);
  return data ? { ...data, state: data.state ?? {} } : null;
}
