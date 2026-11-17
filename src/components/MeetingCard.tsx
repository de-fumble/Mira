"use client";

import { AudioLines, ChevronRight } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import type { MeetingStatus } from "@/lib/transcript";
import { NAV_FORWARD } from "./PageTransition";
import { Spinner } from "./ui";

export type MeetingCardData = {
  id: string;
  title: string;
  status: MeetingStatus;
  time: string;
  duration: string;
  snippet: string | null;
};

/**
 * One meeting. Phones: a row inside a grouped list (`.inset-list` on the <ul>).
 * Larger screens: a card of its own.
 */
export function MeetingCard({ m, index }: { m: MeetingCardData; index: number }) {
  return (
    <li className="stagger" style={{ "--i": Math.min(index, 10) } as React.CSSProperties}>
      <Link
        href={`/meetings/${m.id}`}
        transitionTypes={NAV_FORWARD}
        className="row-link group flex items-center gap-3 px-4 py-3 transition-[box-shadow,transform,background-color] duration-200 ease-[var(--ease-out)] active:bg-sunken sm:gap-5 sm:rounded-[var(--radius-card)] sm:bg-surface sm:p-5 sm:shadow-[var(--shadow-card)] sm:active:scale-[0.99] sm:hover:-translate-y-px sm:hover:shadow-[var(--shadow-card-hover)]"
      >
        <span className="hidden h-12 w-12 flex-none place-items-center rounded-2xl bg-sunken text-ink-2 transition-colors group-hover:bg-ink group-hover:text-white sm:grid">
          <AudioLines aria-hidden className="h-[22px] w-[22px]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] sm:line-clamp-1 sm:text-[17px] sm:tracking-tight">
            {m.title}
          </span>
          <span className="mt-0.5 block truncate text-[14px] text-ink-3 sm:text-[15px]">
            <StatusOrSnippet m={m} />
          </span>
        </span>

        <span className="flex flex-none flex-col items-end gap-0.5 self-start pt-0.5 text-right sm:gap-1 sm:self-center sm:pt-0">
          <span className="text-[13px] tabular-nums text-ink-3 sm:text-[14px] sm:font-medium sm:text-ink-2">{m.time}</span>
          <span className="text-[12px] tabular-nums text-ink-4 sm:text-[13px] sm:text-ink-3">{m.duration}</span>
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

/** Shows a spinner on the row you tapped while the meeting loads. Phones show
 *  no chevron otherwise — the whole row is the button. */
function PendingChevron() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className={`h-6 w-6 flex-none place-items-center text-ink-4 ${pending ? "grid" : "hidden sm:grid"}`}>
      {pending ? (
        <Spinner className="h-4 w-4 text-ink-2" />
      ) : (
        <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" />
      )}
    </span>
  );
}
