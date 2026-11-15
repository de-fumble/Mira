import { MicOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Recorder } from "@/components/Recorder";
import { getFeatures } from "@/lib/features";

export const metadata: Metadata = { title: "New recording" };

export default function RecordPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="sr-only">New recording</h1>
      <Suspense fallback={<div className="card h-[420px] animate-pulse bg-surface" aria-busy="true" />}>
        <RecorderWithSettings />
      </Suspense>
    </div>
  );
}

async function RecorderWithSettings() {
  const features = await getFeatures();
  if (!features.recording) {
    return (
      <div className="card flex animate-fade-up flex-col items-center px-6 py-14 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-sunken text-ink-3">
          <MicOff aria-hidden className="h-7 w-7" />
        </span>
        <h2 className="mt-6 text-[24px] font-semibold tracking-[-0.02em]">Recording is paused</h2>
        <p className="mt-2 max-w-sm text-[16px] text-ink-2">
          New recordings are turned off for a little while. Your existing meetings are still here.
        </p>
        <Link href="/" className="btn btn-md btn-primary mt-7">
          Back to meetings
        </Link>
      </div>
    );
  }
  return <Recorder aiNotes={features.ai_notes} saveAudio={features.audio_storage} />;
}
