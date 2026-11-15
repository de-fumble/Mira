"use client";

import { AudioLines, ChevronRight } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import type { MeetingStatus } from "@/lib/transcript";
import { Spinner } from "./ui";

export type MeetingCardData = {
  id: string;
  title: string;
  status: MeetingStatus;
  time: string;
  duration: string;
  snippet: string | null;
};

export function MeetingCard({ m, index }: { m: MeetingCardData; index: number }) {
  return (
    <li className="stagger" style={{ "--i": Math.min(index, 10) } as React.CSSProperties}>
      <Link
        href={`/meetings/${m.id}`}
        className="group card flex items-center gap-3 px-4 py-3.5 transition-[box-shadow,transform,background-color] duration-300 ease-[var(--ease-out)] active:scale-[0.99] active:bg-sunken/60 sm:gap-5 sm:p-5 sm:hover:-translate-y-px sm:hover:shadow-[var(--shadow-card-hover)]"
      >
        <span className="hidden h-12 w-12 flex-none place-items-center rounded-2xl bg-sunken text-ink-2 transition-colors group-hover:bg-ink group-hover:text-white sm:grid">
          <AudioLines aria-hidden className="h-[22px] w-[22px]" />
        </span>

        <span className="min-w-0 flex-1">
          {/* Phones: full title on up to two lines. Larger screens: one line. */}
          <span className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-tight sm:line-clamp-1">
            {m.title}
          </span>
          <span className="mt-0.5 block truncate text-[15px] text-ink-3">
            <StatusOrSnippet m={m} />
          </span>
          <span className="mt-1 block text-[13px] tabular-nums text-ink-4 sm:hidden">
            {m.time} · {m.duration}
          </span>
        </span>

        <span className="hidden flex-none flex-col items-end gap-1 text-right sm:flex">
          <span className="text-[14px] font-medium tabular-nums text-ink-2">{m.time}</span>
          <span className="text-[13px] tabular-nums text-ink-3">{m.duration}</span>
        </span>

        <PendingChevron />
      </Link>
    </li>
  );
}

function StatusOrSnippet({ m }: { m: MeetingCardData }) {
  if (m.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-accent">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Writing notes…
      </span>
    );
  }
  if (m.status === "recording") return <span className="text-warn">Recording didn’t finish</span>;
  return <>{m.snippet ?? "No summary yet"}</>;
}

/** Shows a spinner on the card you clicked while the meeting loads. */
function PendingChevron() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className="grid h-6 w-6 flex-none place-items-center text-ink-4">
      {pending ? (
        <Spinner className="h-4 w-4 text-ink-2" />
      ) : (
        <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" />
      )}
    </span>
  );
}
