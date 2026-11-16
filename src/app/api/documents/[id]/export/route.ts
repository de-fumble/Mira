import { NextResponse } from "next/server";
import { buildDocumentDocx, buildDocumentPdf, exportFilename } from "@/lib/export";
import { createClient } from "@/lib/supabase/server";
import { getClock } from "@/lib/time";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** GET /api/documents/:id/export?format=docx|pdf — the document as a file. */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/export">) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "docx" && format !== "pdf") {
    return NextResponse.json({ error: "Choose format=docx or format=pdf." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Row Level Security means people can only export their own documents.
  const { data: doc } = await supabase
    .from("documents")
    .select("title, content, updated_at")
    .eq("id", id)
    .maybeSingle<{ title: string; content: string; updated_at: string }>();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const clock = await getClock();
  const shortDate = new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(doc.updated_at),
  );
  const body = format === "docx" ? await buildDocumentDocx(doc) : await buildDocumentPdf(doc);
  const name = exportFilename(doc.title, shortDate, format);
  const ascii = name.replace(/[^\x20-\x7e]/g, "-").replace(/"/g, "'");

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
    },
  });
}
