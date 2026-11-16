import { after, NextResponse } from "next/server";
import { countWords, hashText, REVIEW_MAX_WORDS, scoreFor, type DocAnalysis } from "@/lib/documents";
import { proofread, ReviewBusyError, ReviewUnavailableError } from "@/lib/proofread";
import { logReview } from "@/lib/review-log";
import { createClient } from "@/lib/supabase/server";

// Long documents take a while to review.
export const maxDuration = 300;

/**
 * POST /api/documents/:id/analyze — AI proofreading of the saved text:
 * flags spelling, grammar, unclear and off-topic sentences and scores the
 * document. Row Level Security limits this to the owner's documents.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]/analyze">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: doc } = await supabase.from("documents").select("title, content").eq("id", id).maybeSingle<{ title: string; content: string }>();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const words = countWords(doc.content);
  if (words < 3) return NextResponse.json({ error: "Write or dictate a few sentences first." }, { status: 400 });
  if (words > REVIEW_MAX_WORDS) {
    return NextResponse.json(
      { error: `This document has ${words.toLocaleString("en")} words. AI review works on up to ${REVIEW_MAX_WORDS.toLocaleString("en")} — split it into parts.` },
      { status: 400 },
    );
  }

  const userId = claims.claims.sub;
  const started = Date.now();
  let reviewed = false;
  try {
    const { review, meta } = await proofread(doc.title, doc.content);
    const issues = review.issues.map((issue, i) => ({ ...issue, id: `${Date.now().toString(36)}-${i}` }));
    const score = scoreFor(issues, words);
    reviewed = true;
    // For the admin dashboard — after the reply, so it never slows the review.
    const durationMs = Date.now() - started;
    after(() => logReview({ userId, documentId: id, words, durationMs, meta, issues, score }));
    const analysis: DocAnalysis = {
      score,
      summary: review.summary,
      issues,
      dismissed: [],
      word_count: words,
      content_hash: hashText(doc.content),
      analyzed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("documents").update({ analysis }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ analysis });
  } catch (err) {
    if (!reviewed) {
      const durationMs = Date.now() - started;
      after(() => logReview({ userId, documentId: id, words, durationMs, error: err }));
    }
    if (err instanceof ReviewUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof ReviewBusyError) return NextResponse.json({ error: err.message }, { status: 429 });
    console.error("Document review failed", err);
    return NextResponse.json({ error: "The review didn’t finish. Please try again." }, { status: 500 });
  }
}
