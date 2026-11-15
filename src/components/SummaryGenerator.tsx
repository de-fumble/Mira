"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Spinner } from "./ui";

const STEPS = ["Reading the transcript", "Finding decisions and action items", "Writing your summary"];

/**
 * Asks the server to write the meeting notes. auto=true starts right away
 * (just after a recording is saved); variant="rewrite" is a small button.
 */
export function SummaryGenerator({
  meetingId,
  auto = false,
  variant = "panel",
}: {
  meetingId: string;
  auto?: boolean;
  variant?: "panel" | "rewrite";
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">(auto ? "working" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const started = useRef(false);

  const run = useCallback(async () => {
    setState("working");
    setError(null);
    setStep(0);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summarize`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }, [meetingId, router]);

  // Walk through the progress messages while waiting.
  useEffect(() => {
    if (state !== "working") return;
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    // Guard: React runs effects twice in development.
    if (auto && !started.current) {
      started.current = true;
      void run();
    }
  }, [auto, run]);

  if (variant === "rewrite") {
    return (
      <button type="button" onClick={run} disabled={state === "working"} className="btn btn-sm btn-ghost">
        {state === "working" ? <Spinner /> : <RotateCcw aria-hidden className="h-4 w-4" />}
        {state === "working" ? "Rewriting…" : "Rewrite"}
      </button>
    );
  }

  if (state === "working") {
    return (
      <div role="status" aria-live="polite" className="animate-fade-in">
        <p className="mb-5 flex items-center gap-2.5 text-[15px] font-medium text-ink-2">
          <Spinner className="h-4 w-4 text-accent" />
          <span key={step} className="animate-fade-in">
            {STEPS[step]}…
          </span>
        </p>
        <div className="space-y-3" aria-hidden>
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-[92%]" />
          <div className="skeleton h-4 w-[64%]" />
          <div className="pt-4" />
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-12 w-full rounded-xl" />
          <div className="skeleton h-12 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4">
      {error ? (
        <Notice tone="error" title="The notes couldn’t be written" className="w-full">
          {error}
        </Notice>
      ) : (
        <p className="text-[16px] text-ink-2">Turn this transcript into a short summary with decisions and action items.</p>
      )}
      <button type="button" onClick={run} className="btn btn-md btn-primary">
        {error ? <RotateCcw aria-hidden className="h-4 w-4" /> : <Sparkles aria-hidden className="h-4 w-4" />}
        {error ? "Try again" : "Write notes"}
      </button>
    </div>
  );
}
