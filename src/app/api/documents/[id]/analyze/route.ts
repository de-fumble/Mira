import { NextResponse } from "next/server";
import type { DocAnalysis } from "@/lib/documents";
import type { ReviewEvent } from "@/lib/review/events";
import { claimReviewJob, finishReviewJob } from "@/lib/review/jobs";
import { checkLength, runReviewJob } from "@/lib/review/run-job";
import { toPlain } from "@/lib/rich-text";
import { createClient } from "@/lib/supabase/server";

// Long documents take a while to review.
export const maxDuration = 300;

/** This run stops starting new attempts this long after it began (maxDuration is 300 s). */
const RUN_BUDGET_MS = 285_000;

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  // Don't let proxies hold the progress lines back.
  "X-Accel-Buffering": "no",
};
const ndjson = (line: ReviewEvent) => new Response(JSON.stringify(line) + "\n", { headers: STREAM_HEADERS });

/**
 * POST /api/documents/:id/analyze — runs the correction engine on the saved
 * text (see lib/review/pipeline.ts) and saves the result.
 *
 * Answers with a stream of newline-separated JSON (ReviewEvent): a "stage"
 * line as each step starts or progresses, then one "done" line with the
 * analysis. Problems found before the review starts (signed out, missing, too
 * short or long) are plain JSON with a status code.
 *
 * A review never fails because the AI is busy, slow or out of quota: it keeps
 * its place (lib/review/jobs.ts), waits and tries again — within this request
 * while there's time, then by ending on a "waiting" line that says when to
 * ask again. Asking again with `?resume=1&known=<analyzed_at of the review the
 * browser has>` carries on from where it stopped, answers "done" if the review
 * finished in the meantime, or "waiting" while another run (another request,
 * or the scheduler: /api/cron/reviews) is on it.
 *
 * Row Level Security limits all of this to the owner's documents.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/documents/[id]/analyze">) {
  const { id } = await ctx.params;
  const query = new URL(req.url).searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("content, analysis")
    .eq("id", id)
    .maybeSingle<{ content: string; analysis: DocAnalysis | null }>();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  // Carrying on a review that has since finished (in another run): hand back its result.
  if (query.get("resume") === "1" && doc.analysis && doc.analysis.analyzed_at !== (query.get("known") ?? "")) {
    return ndjson({ type: "done", analysis: doc.analysis });
  }

  // The review reads the words only (headings, bullets and bold are formatting).
  const problem = checkLength(toPlain(doc.content));
  if (problem) {
    await finishReviewJob(supabase, id); // nothing to carry on with
    return NextResponse.json({ error: problem.error }, { status: problem.status });
  }

  const claim = await claimReviewJob(supabase, id);
  if (claim.status === "held") {
    // Another run is on it: check back shortly.
    const leaseLeft = claim.job?.lease_until ? Date.parse(claim.job.lease_until) - Date.now() : 0;
    return ndjson({ type: "waiting", retryInMs: Math.min(20_000, Math.max(5_000, leaseLeft)), ...(claim.job?.state.place ?? { stage: "check" }) });
  }
  const job = claim.status === "claimed" ? { tracked: true, state: claim.job.state, rounds: claim.job.rounds } : { tracked: false, state: {}, rounds: 0 };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: ReviewEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false; // the writer closed the page; keep going so the review is still saved
        }
      };
      try {
        await runReviewJob({ supabase, documentId: id, userId: claims.claims.sub, job, send, runEnds: Date.now() + RUN_BUDGET_MS });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
