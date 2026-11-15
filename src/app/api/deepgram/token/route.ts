import { NextResponse } from "next/server";
import { getFeatures } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/deepgram/token
 * Gives a signed-in user a short-lived (30 s) Deepgram token so the browser
 * can open the live-transcription connection directly. The real Deepgram API
 * key never leaves the server. The token only has to be valid when the
 * connection opens; the stream then stays open until closed.
 */
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (!(await getFeatures()).recording) {
    return NextResponse.json({ error: "Recording is turned off right now. Please try again later." }, { status: 403 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Live transcription isn't set up: add DEEPGRAM_API_KEY to .env.local and restart." },
      { status: 503 },
    );
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("Deepgram token grant failed", res.status, await res.text());
    return NextResponse.json(
      { error: "Couldn't connect to the transcription service. Check DEEPGRAM_API_KEY." },
      { status: 502 },
    );
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return NextResponse.json({ token: access_token }, { headers: { "Cache-Control": "no-store" } });
}
