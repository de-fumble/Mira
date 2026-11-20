import { ChevronRight, Download, FileText, Mic, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createDocument } from "@/app/document-actions";
import { NewDocumentButton } from "@/components/documents/NewDocumentButton";
import { ReviewChip } from "@/components/documents/ReviewChip";
import { UploadDocumentButton } from "@/components/documents/UploadDocumentButton";
import { NAV_FORWARD } from "@/components/PageTransition";
import { Notice } from "@/components/ui";
import { currentScore, type DocAnalysis } from "@/lib/documents";
import { pendingReviewIds } from "@/lib/review/jobs";
import { toPlain } from "@/lib/rich-text";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate, getClock } from "@/lib/time";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage(props: PageProps<"/documents">) {
  return (
    <>
      <div className="flex flex-col gap-6 sm:gap-8">
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Speech to document</p>
            <h1 className="mt-1 text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[38px] sm:leading-tight sm:tracking-[-0.03em]">
              Documents
            </h1>
            <p className="mt-1.5 max-w-xl text-[16px] text-ink-3 max-sm:hidden">
              Talk instead of typing. Mira writes it down, checks it, and gives you a Word or PDF file.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <UploadDocumentButton compact />
            <form action={createDocument}>
              <NewDocumentButton shortLabel="New" />
            </form>
          </div>
        </header>
        <Suspense fallback={<ListSkeleton />}>
          <DocumentList searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

/** First words of a document for the list (no formatting markers, on one line). */
const preview = (stored: string) => toPlain(stored.slice(0, 600)).replace(/\s+/g, " ").trim().slice(0, 180);

type Row = { id: string; title: string; content: string; word_count: number; analysis: DocAnalysis | null; updated_at: string };

async function DocumentList({ searchParams }: { searchParams: PageProps<"/documents">["searchParams"] }) {
  const [{ error: errorParam }, supabase, clock] = await Promise.all([searchParams, createClient(), getClock()]);
  const [{ data, error }, pending] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, content, word_count, analysis, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200)
      .returns<Row[]>(),
    // AI reviews still going (migration 0007): shown as "Reviewing…" and carried on from here.
    pendingReviewIds(supabase).then((ids) => new Set(ids)),
  ]);

  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /could not find the table/i.test(error.message);
    return (
      <Notice tone={missing ? "warn" : "error"} title={missing ? "Documents need a one-time setup" : "Couldn’t load your documents"}>
        {missing
          ? "Run supabase/migrations/0004_documents.sql in the Supabase SQL editor, then reload this page."
          : "Please reload the page to try again."}
      </Notice>
    );
  }

  const docs = data ?? [];
  return (
    <>
      {errorParam === "create" && <Notice tone="error" title="Couldn’t create a new document">Please try again.</Notice>}
      {docs.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="inset-list flex flex-col sm:gap-3">
          {docs.map((d, i) => (
            <li key={d.id} className="stagger" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
              <Link
                href={`/documents/${d.id}`}
                transitionTypes={NAV_FORWARD}
                className="row-link group flex items-center gap-3 px-4 py-3 transition-[box-shadow,transform,background-color] duration-200 ease-[var(--ease-out)] active:bg-sunken sm:gap-5 sm:rounded-[var(--radius-card)] sm:bg-surface sm:p-5 sm:shadow-[var(--shadow-card)] sm:active:scale-[0.99] sm:hover:-translate-y-px sm:hover:shadow-[var(--shadow-card-hover)]"
              >
                <span className="hidden h-12 w-12 flex-none place-items-center rounded-2xl bg-sunken text-ink-2 transition-colors group-hover:bg-ink group-hover:text-white sm:grid">
                  <FileText aria-hidden className="h-[22px] w-[22px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] sm:line-clamp-1 sm:text-[17px] sm:tracking-tight">
                    {d.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[14px] text-ink-3 sm:text-[15px]">
                    {preview(d.content) || "Empty — open it and start dictating."}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums text-ink-4">
                    <span>{d.word_count.toLocaleString("en")} words</span>
                    <span>Edited {formatShortDate(d.updated_at, clock)}</span>
                    <ReviewChip
                      id={d.id}
                      score={d.analysis ? currentScore(d.analysis, toPlain(d.content)) : null}
                      pending={pending.has(d.id)}
                      known={d.analysis?.analyzed_at ?? null}
                    />
                  </span>
                </span>
                <ChevronRight aria-hidden className="h-5 w-5 flex-none text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink-2 max-sm:hidden" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EmptyState() {
  const steps = [
    { Icon: Mic, title: "Speak", text: "Press Dictate and read or talk. Say “comma”, “new paragraph” or “pause dictation” as you go — the commands are listed while you talk." },
    { Icon: Sparkles, title: "Review", text: "AI review flags misspelt words, sentences that don’t make sense and ones that don’t belong." },
    { Icon: Download, title: "Export", text: "Download a clean Word document or PDF, ready to send." },
  ];
  return (
    <section className="card animate-fade-up overflow-hidden">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-white">
            <Mic aria-hidden className="h-6 w-6" />
          </span>
          <h2 className="mt-5 text-[24px] font-semibold tracking-tight">Your first document</h2>
          <p className="mt-2 text-[16px] leading-relaxed text-ink-3">
            Speaking is about three times faster than typing. A 3,000-word document takes around 20 minutes to read out.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <form action={createDocument}>
              <NewDocumentButton label="Start dictating" />
            </form>
            <UploadDocumentButton label="Upload a document" align="left" />
          </div>
          <p className="mt-3 text-[14px] text-ink-3">Already have one? Upload a Word document and dictate new parts into it.</p>
        </div>
        <ol className="flex flex-col gap-3">
          {steps.map(({ Icon, title, text }, i) => (
            <li key={title} className="flex gap-4 rounded-2xl bg-sunken p-4">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-surface text-ink-2 shadow-[var(--shadow-card)]">
                <Icon aria-hidden className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">
                  {i + 1}. {title}
                </span>
                <span className="block text-[14px] leading-relaxed text-ink-3">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden>
      <div className="divide-y divide-line overflow-hidden rounded-[20px] bg-surface sm:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 px-4 py-3.5">
            <div className="skeleton h-4 w-3/5" />
            <div className="skeleton h-3.5 w-4/5" />
            <div className="skeleton h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 max-sm:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[92px] rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}
