"use client";

import { CircleCheck, CircleExclamationPoint, FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { testCorrectionEngine } from "@/app/admin-actions";
import { formatSeconds } from "@/lib/format-ms";
import type { EngineTestResult } from "@/lib/review-test";
import { Spinner } from "../ui";

/** Runs one real review on a sample paragraph and shows how it went. */
export function EngineTest() {
  const router = useRouter();
  const [result, setResult] = useState<EngineTestResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const run = () => {
    setResult(null);
    setElapsed(0);
    startTransition(async () => {
      try {
        setResult(await testCorrectionEngine());
      } catch {
        setResult({ ok: false, outcome: "failed", error: "Couldn’t reach the server.", ms: 0 });
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-5 border-t border-line pt-5">
      <button type="button" onClick={run} disabled={pending} className="btn btn-sm btn-secondary">
        {pending ? <Spinner /> : <FlaskConical aria-hidden className="h-4 w-4" />}
        {pending ? `Reviewing… ${formatSeconds(elapsed)}` : "Run a test review"}
      </button>
      <p className="mt-2 text-[13px] text-ink-3">
        Sends a short sample with 9 planted mistakes through the engine. It can take a minute.
      </p>
      <div aria-live="polite">
        {result?.ok && (
          <div className="mt-4 animate-fade-up rounded-2xl bg-sunken/70 p-4 text-[14px]">
            <p className="flex items-center gap-2 font-semibold">
              <CircleCheck aria-hidden className={`h-4 w-4 ${result.caught === result.total ? "text-success" : "text-warn"}`} />
              Caught {result.caught} of {result.total} mistakes
            </p>
            <p className="mt-1 text-ink-3">
              {result.model}
              {result.backup && " (backup)"} · {formatSeconds(result.ms)}
              {result.extra > 0 && ` · ${result.extra} other ${result.extra === 1 ? "flag" : "flags"}`}
            </p>
            {result.missed.length > 0 && <p className="mt-1 text-ink-3">Missed: {result.missed.join(", ")}</p>}
          </div>
        )}
        {result && !result.ok && (
          <div className="mt-4 animate-fade-up rounded-2xl bg-danger-soft p-4 text-[14px]">
            <p className="flex items-center gap-2 font-semibold text-danger">
              <CircleExclamationPoint aria-hidden className="h-4 w-4" />
              {result.outcome === "busy" ? "Every model was busy" : result.outcome === "unavailable" ? "Not set up" : "The test review failed"}
            </p>
            <p className="mt-1 text-ink-2">{result.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
