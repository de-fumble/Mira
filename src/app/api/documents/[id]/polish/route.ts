import { NextResponse } from "next/server";
import { cleanDictation } from "@/lib/dictation";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

// Same as live dictation, but over the whole recording at once: better
// accuracy, numbers and punctuation than the live stream.
const LISTEN_URL =
  "https://api.deepgram.com/v1/listen?" +
  new URLSearchParams({ model: "nova-3", language: "en", punctuate: "true", smart_format: "true" });

/**
 * POST /api/documents/:id/polish  { path }
 * Re-transcribes a dictation the browser just uploaded to the user's
 * storage folder, then deletes the audio. Returns the transcript.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/polish">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  // Only the user's own dictation files for this document.
  if (!new RegExp(`^${userId}/dictation/${id}-\\d+\\.(webm|m4a|ogg)$`).test(path)) {
    return NextResponse.json({ error: "Unknown recording." }, { status: 400 });
  }
  const remove = () => supabase.storage.from("recordings").remove([path]);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    await remove();
    return NextResponse.json({ error: "Transcription isn’t set up." }, { status: 503 });
  }

  try {
    const { data: signed } = await supabase.storage.from("recordings").createSignedUrl(path, 600);
    if (!signed?.signedUrl) return NextResponse.json({ error: "Recording not found." }, { status: 404 });

    const res = await fetch(LISTEN_URL, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: signed.signedUrl }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("Deepgram polish failed", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ error: "Couldn’t polish this dictation." }, { status: 502 });
    }
    const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
    const raw = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    // `raw` keeps the spoken commands ("scratch that", "caps on"…), which the
    // editor applies the same way it did during live dictation.
    return NextResponse.json({ text: cleanDictation(raw), raw });
  } finally {
    await remove(); // dictation audio is never kept
  }
}
