import { NextResponse } from "next/server";
import { countWords, hashText, REVIEW_MAX_WORDS, type DocAnalysis } from "@/lib/documents";
import type { ReviewEvent } from "@/lib/review/events";
import { ReviewBusyError, ReviewUnavailableError } from "@/lib/review/gemini";
import { PIPELINE_VERSION, runReview } from "@/lib/review/pipeline";
import { logReview } from "@/lib/review-log";
import { toPlain } from "@/lib/rich-text";
import { createClient } from "@/lib/supabase/server";

// Long documents take a while to review.
export const maxDuration = 300;

/**
 * POST /api/documents/:id/analyze — runs the correction engine on the saved
 * text (see lib/review/pipeline.ts) and saves the result.
 *
 * Answers with a stream of newline-separated JSON (ReviewEvent): a "stage"
 * line as each step starts or progresses, then one "done" line with the
 * analysis, or an "error" line. Problems found before the review starts
 * (signed out, missing, too short or long) are plain JSON with a status code.
 * Row Level Security limits this to the owner's documents.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/analyze">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: doc } = await supabase.from("documents").select("title, content").eq("id", id).maybeSingle<{ title: string; content: string }>();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  // The review reads the words only (headings, bullets and bold are formatting).
  const content = toPlain(doc.content);
  const words = countWords(content);
  if (words < 3) return NextResponse.json({ error: "Write or dictate a few sentences first." }, { status: 400 });
  if (words > REVIEW_MAX_WORDS) {
    return NextResponse.json(
      { error: `This document has ${words.toLocaleString("en")} words. AI review works on up to ${REVIEW_MAX_WORDS.toLocaleString("en")} — split it into parts.` },
      { status: 400 },
    );
  }

  const userId = claims.claims.sub;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: ReviewEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false; // the writer closed the page; keep going so the review is still saved
        }
      };
      const started = Date.now();
      let reviewed = false;
      try {
        const result = await runReview({ title: doc.title, content, onProgress: send });
        reviewed = true;
        const stamp = Date.now().toString(36);
        const issues = result.issues.map((issue, i) => ({ ...issue, id: `${stamp}-${i}` }));
        const analysis: DocAnalysis = {
          score: result.score,
          summary: result.summary,
          issues,
          dismissed: [],
          word_count: words,
          content_hash: hashText(content),
          analyzed_at: new Date().toISOString(),
          brief: result.brief,
          pipeline: { version: PIPELINE_VERSION, parts: result.parts, stages: result.stages },
        };
        const { error } = await supabase.from("documents").update({ analysis }).eq("id", id);
        if (error) throw error;
        send({ type: "done", analysis });
        // For the admin dashboard (never throws).
        await logReview({ userId, documentId: id, words, durationMs: Date.now() - started, meta: result.meta, issues, score: result.score });
      } catch (err) {
        if (!reviewed) await logReview({ userId, documentId: id, words, durationMs: Date.now() - started, error: err });
        if (err instanceof ReviewUnavailableError) send({ type: "error", error: err.message, status: 503 });
        else if (err instanceof ReviewBusyError) send({ type: "error", error: err.message, status: 429 });
        else {
          console.error("Document review failed", err);
          send({ type: "error", error: "The review didn’t finish. Please try again.", status: 500 });
        }
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Don't let proxies hold the progress lines back.
      "X-Accel-Buffering": "no",
    },
  });
}
