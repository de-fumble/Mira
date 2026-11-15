"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card mx-auto flex max-w-lg animate-fade-up flex-col items-center px-6 py-14 text-center">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Something went wrong</h1>
      <p className="mt-2 text-[16px] text-ink-3">This is usually a brief connection problem. Your recordings are safe.</p>
      <button type="button" onClick={() => retry()} className="btn btn-md btn-primary mt-7">
        <RotateCcw aria-hidden className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
