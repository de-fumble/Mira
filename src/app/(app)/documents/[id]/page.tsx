import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { NAV_BACK } from "@/components/PageTransition";
import type { DocumentRow } from "@/lib/documents";
import { getFeatures } from "@/lib/features";
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
        <Document params={props.params} />
      </Suspense>
    </>
  );
}

async function Document({ params }: { params: PageProps<"/documents/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [supabase, features] = await Promise.all([createClient(), getFeatures()]);
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, content, analysis")
    .eq("id", id)
    .maybeSingle<Pick<DocumentRow, "id" | "title" | "content" | "analysis">>();
  if (!doc) notFound();
  return <DocumentEditor key={doc.id} doc={doc} dictationEnabled={features.recording} />;
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
