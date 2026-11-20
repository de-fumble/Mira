"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { scoreLabel } from "@/lib/documents";
import { onReviewFinished, startReview, useReviewRun } from "./review-runner";

const TONE = { good: "bg-success-soft text-success", ok: "bg-accent-soft text-accent", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger" };

/**
 * A document's score on the documents list — or "Reviewing…" while an AI
 * review of it is still going. An unfinished one (`pending`) carries on from
 * here, and the list refreshes when it's done.
 */
export function ReviewChip({ id, score, pending, known }: { id: string; score: number | null; pending: boolean; known: string | null }) {
  const run = useReviewRun(id);
  const router = useRouter();
  const resumed = useRef(false);
  useEffect(() => {
    if (!pending || resumed.current) return;
    resumed.current = true;
    startReview(id, { resume: true, known });
  }, [id, pending, known]);
  useEffect(() => onReviewFinished((done) => done === id && router.refresh()), [id, router]);

  if (run.phase === "running" || (pending && run.phase === "idle")) {
    return <span className="rounded-full bg-sunken px-2 py-0.5 text-[12px] font-semibold text-ink-3">Reviewing…</span>;
  }
  if (score === null) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONE[scoreLabel(score).tone]}`}>Score {score}</span>;
}
