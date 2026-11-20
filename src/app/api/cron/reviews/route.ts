import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { claimDueReviewJob, dueReviewJobs } from "@/lib/review/jobs";
import { runReviewJob } from "@/lib/review/run-job";
import { createAdminClient } from "@/lib/supabase/admin";

// Each review may take a while; they run after the answer is sent.
export const maxDuration = 300;

/** Reviews carried on per call (the scheduler calls every minute while any are due). */
const PER_CALL = 5;
/** No new attempt starts this long after the call (maxDuration is 300 s). */
const RUN_BUDGET_MS = 280_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * POST /api/cron/reviews — called by Supabase's scheduler (pg_cron + pg_net,
 * see supabase/migrations/0008_review_scheduler.sql) while AI reviews are
 * waiting to be tried again. Carries on each due review from where it stopped,
 * even if its writer has closed Mira, so it still finishes on its own.
 *
 * Needs `Authorization: Bearer <CRON_SECRET>`. Answers straight away with how
 * many reviews it took; the reviews themselves run after the answer is sent.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET isn’t set on the server." }, { status: 503 });
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  const admin = createAdminClient();
  const due = await dueReviewJobs(admin, PER_CALL);
  const claimed = (await Promise.all(due.map((j) => claimDueReviewJob(admin, j.document_id)))).filter((j) => j !== null);

  if (claimed.length) {
    const runEnds = Date.now() + RUN_BUDGET_MS;
    after(() =>
      Promise.all(
        claimed.map((job) =>
          runReviewJob({
            supabase: admin, // secret key: the run only reads and writes this one document and its job
            documentId: job.document_id,
            userId: job.user_id,
            job: { tracked: true, state: job.state, rounds: job.rounds },
            runEnds,
            retryWithinRun: false, // one attempt per call; the next call (once it's due again) is the retry
          }).catch((err) => console.error("Scheduled review run stopped", err)),
        ),
      ),
    );
  }
  return NextResponse.json({ due: due.length, started: claimed.length });
}
