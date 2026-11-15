import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { getFeatures } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { SummaryUnavailableError, summarizeTranscript } from "@/lib/summarize";

// Long meetings can take a while to summarise.
export const maxDuration = 300;

/**
 * POST /api/meetings/:id/summarize
 * Writes the AI notes (title, summary, decisions, action items) for one of
 * the signed-in user's meetings. Row Level Security guarantees users can
 * only summarise their own meetings.
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/meetings/[id]/summarize">) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  if (!(await getFeatures()).ai_notes) {
    // Don't leave the meeting showing "Writing notes…" forever.
    await supabase.from("meetings").update({ status: "ready" }).eq("id", id).eq("status", "processing");
    return NextResponse.json({ error: "AI notes are turned off right now." }, { status: 403 });
  }

  const { data: meeting, error } = await supabase
    .from("meetings")
    .select("id, title, transcript_text, summary")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });

  const text = meeting.transcript_text?.trim();
  if (!text) {
    await supabase.from("meetings").update({ status: "ready" }).eq("id", id);
    return NextResponse.json({ ok: true, skipped: "No speech was transcribed." });
  }

  try {
    const summary = await summarizeTranscript(text);
    const { error: saveError } = await supabase
      .from("meetings")
      .update({ summary, status: "ready" })
      .eq("id", id);
    if (saveError) throw saveError;

    // The AI names the meeting only on its first notes, and only if the
    // title is still the one it had when we started — so a title the user
    // typed (before or during summarising, or any time before "Rewrite")
    // is never overwritten.
    if (!meeting.summary) {
      await supabase.from("meetings").update({ title: summary.title }).eq("id", id).eq("title", meeting.title);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Keep the transcript usable even if the summary fails.
    await supabase.from("meetings").update({ status: "ready" }).eq("id", id);

    if (err instanceof SummaryUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY was rejected." }, { status: 503 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
    }
    console.error("Summary failed", err);
    const message = err instanceof Error ? err.message : "Summary failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
