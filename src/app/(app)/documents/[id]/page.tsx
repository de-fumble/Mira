import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { NAV_BACK } from "@/components/PageTransition";
import type { DocumentRow } from "@/lib/documents";
import { getFeatures } from "@/lib/features";
import { readReviewJob } from "@/lib/review/jobs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Document" };

export default function DocumentPage(props: PageProps<"/documents/[id]">) {
  return (
    <>
      <Link
        href="/documents"
        transitionTypes={NAV_BACK}
        className="tap -ml-2 mb-3 inline-flex h-11 items-center gap-1 rounded-full pl-1.5 pr-3.5 text-[15px] font-medium text-ink-3 transition hover:bg-hover hover:text-ink active:bg-hover sm:mb-6 sm:h-9"
      >
        <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />
        Documents
      </Link>
      <Suspense fallback={<EditorSkeleton />}>
        <Document params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Document({ params, searchParams }: Pick<PageProps<"/documents/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Just uploaded (see importDocument): say what came across.
  const imported = query.imported ? { images: Number(query.images) || 0, tables: Number(query.tables) || 0 } : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [supabase, features] = await Promise.all([createClient(), getFeatures()]);
  const [{ data: doc }, job] = await Promise.all([
    supabase
      .from("documents")
      // "*": the dictation totals (migration 0006) are read when the columns exist.
      .select("*")
      .eq("id", id)
      .maybeSingle<DocumentRow & { dictated_words?: number; dictation_seconds?: number }>(),
    // An AI review that hasn't finished yet (migration 0007) carries on when the document opens.
    readReviewJob(supabase, id),
  ]);
  if (!doc) notFound();
  const dictated = { words: doc.dictated_words ?? 0, seconds: doc.dictation_seconds ?? 0 };
  return (
    <DocumentEditor
      key={doc.id}
      doc={{ id: doc.id, title: doc.title, content: doc.content, analysis: doc.analysis }}
      dictated={dictated}
      imported={imported}
      reviewPending={job ? (job.state.place ?? { stage: "read" }) : null}
      dictationEnabled={features.recording}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="skeleton h-10 w-2/3 rounded-xl" />
      <div className="skeleton h-4 w-40 rounded-full" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="skeleton h-[60vh] rounded-[var(--radius-card)]" />
        <div className="skeleton hidden h-72 rounded-[var(--radius-card)] lg:block" />
      </div>
    </div>
  );
}
