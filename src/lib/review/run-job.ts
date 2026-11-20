import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countWords, hashText, REVIEW_MAX_WORDS, type DocAnalysis } from "../documents";
import { logReview } from "../review-log";
import { toPlain } from "../rich-text";
import type { ReviewEvent, ReviewPlace } from "./events";
import { finishReviewJob, retryDelayMs, saveReviewJob, type ReviewJobState } from "./jobs";
import { PIPELINE_VERSION, runReview } from "./pipeline";

/*
 * One run of a document's review: tries, and while there's time left waits and
 * tries again, carrying on from the saved checkpoint (lib/review/jobs.ts).
 * Used by the analyze route (the writer's own Supabase client, so Row Level
 * Security applies) and by the scheduler (/api/cron/reviews, secret key —
 * it only ever touches the one document it was given).
 */

/** Don't start another attempt in this run with less time than this left. */
const MIN_ATTEMPT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Problems the writer can fix (not worth retrying). */
export function checkLength(content: string): { error: string; status: number } | null {
  const words = countWords(content);
  if (words < 3) return { error: "Write or dictate a few sentences first.", status: 400 };
  if (words > REVIEW_MAX_WORDS) {
    return {
      error: `This document has ${words.toLocaleString("en")} words. AI review works on up to ${REVIEW_MAX_WORDS.toLocaleString("en")} — split it into parts.`,
      status: 400,
    };
  }
  return null;
}

export type JobOutcome = "done" | "waiting" | "error" | "gone";

export async function runReviewJob(opts: {
  supabase: SupabaseClient;
  documentId: string;
  /** For the admin log. */
  userId: string | null;
  /** The claimed job (`tracked` false: jobs can't be saved, so nothing is kept between runs). */
  job: { tracked: boolean; state: ReviewJobState; rounds: number };
  /** Progress for the writer's browser, if one is listening. */
  send?: (e: ReviewEvent) => void;
  /** Epoch ms after which no new attempt starts. */
  runEnds: number;
  /**
   * Wait and try again within this run while there's time (default). The
   * scheduler makes one attempt per call instead: its next call, once the
   * review is due again, is the retry — no function sits waiting.
   */
  retryWithinRun?: boolean;
}): Promise<JobOutcome> {
  const { supabase, documentId: id, userId, job, runEnds, retryWithinRun = true } = opts;
  const send = opts.send ?? (() => {});
  const state = job.state;
  let rounds = job.rounds;
  // Where the review is — saved with the checkpoint, so it can be shown when the writer comes back.
  let place: ReviewPlace = state.place ?? { stage: "read" };
  const onProgress = (e: ReviewEvent) => {
    send(e);
    if (e.type !== "stage") return;
    const check = e.stage === "check";
    place = { stage: e.stage, done: check ? e.done : undefined, total: check ? e.total : undefined, about: e.stage === "understand" && e.detail ? e.detail : place.about };
  };
  const save = (extra: Parameters<typeof saveReviewJob>[2] = {}) =>
    job.tracked ? saveReviewJob(supabase, id, { state: { ...state, place }, ...extra }) : Promise.resolve();

  let released = false; // the job is finished or handed back
  try {
    for (;;) {
      // The writer may have edited while the review waited: always review the latest text.
      const { data: doc } = await supabase.from("documents").select("title, content").eq("id", id).maybeSingle<{ title: string; content: string }>();
      if (!doc) {
        released = true;
        return "gone"; // deleted (its job went with it)
      }
      const content = toPlain(doc.content);
      const problem = checkLength(content);
      if (problem) {
        await finishReviewJob(supabase, id);
        released = true;
        send({ type: "error", ...problem });
        return "error";
      }
      const words = countWords(content);
      const started = Date.now();
      let reviewed = false;
      try {
        const result = await runReview({ title: doc.title, content, onProgress, deadline: runEnds, checkpoint: state, onCheckpoint: () => save() });
        reviewed = true;
        const stamp = Date.now().toString(36);
        const issues = result.issues.map((issue, i) => ({ ...issue, id: `${stamp}-${i}` }));
        const analysis: DocAnalysis = {
          score: result.score,
          summary: result.summary,
          issues,
          dismissed: [],
          word_count: words,
          content_hash: hashText(content),
          analyzed_at: new Date().toISOString(),
          brief: result.brief,
          pipeline: { version: PIPELINE_VERSION, parts: result.parts, stages: result.stages },
        };
        const { error } = await supabase.from("documents").update({ analysis }).eq("id", id);
        if (error) throw error;
        await finishReviewJob(supabase, id);
        released = true;
        send({ type: "done", analysis });
        // For the admin dashboard (never throws).
        await logReview({ userId, documentId: id, words, durationMs: Date.now() - started, meta: result.meta, issues, score: result.score });
        return "done";
      } catch (err) {
        // Busy, slow, out of quota or something unexpected. The writer only hears
        // that it's still going; the admin dashboard gets the details.
        if (!reviewed) await logReview({ userId, documentId: id, words, durationMs: Date.now() - started, error: err });
        else console.error("Review finished but couldn’t be saved", err);
        rounds++;
        const wait = retryDelayMs(rounds, err);
        const next_at = new Date(Date.now() + wait).toISOString();
        if (retryWithinRun && runEnds - Date.now() - wait >= MIN_ATTEMPT_MS) {
          // Time for another go in this run.
          send({ type: "waiting", retryInMs: wait, ...place });
          await save({ rounds, next_at });
          await sleep(wait);
          continue;
        }
        // Out of time here: keep the place; the browser or the scheduler carries on later.
        await save({ rounds, next_at, lease_until: null });
        released = true;
        send({ type: "waiting", retryInMs: wait, ...place });
        return "waiting";
      }
    }
  } catch (err) {
    // Not expected (the loop handles failed reviews) — still, never an error for the writer.
    console.error("Document review run stopped", err);
    send({ type: "waiting", retryInMs: 30_000, ...place });
    return "waiting";
  } finally {
    if (!released) await save({ lease_until: null });
  }
}
