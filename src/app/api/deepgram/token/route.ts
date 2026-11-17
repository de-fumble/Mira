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

  // Time-limited, so a slow Deepgram never leaves someone stuck on "Connecting…".
  let res: Response;
  const started = Date.now();
  try {
    res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error(`Deepgram token grant ${timedOut ? "timed out" : "failed to connect"} after ${Date.now() - started} ms`, err);
    return NextResponse.json(
      { error: "The transcription service didn’t respond. Please try again in a moment." },
      { status: 504 },
    );
  }

  if (!res.ok) {
    // Shows up in the server logs (e.g. Vercel → Logs) with Deepgram's own reason.
    console.error("Deepgram token grant failed", res.status, (await res.text()).slice(0, 500));
    const error =
      res.status === 429
        ? "The transcription service is at its limit right now. Please try again in a minute."
        : res.status === 401 || res.status === 403
          ? "Live transcription isn’t set up correctly: the Deepgram key was rejected (it needs the Member role or higher)."
          : res.status === 402
            ? "Live transcription is paused: the Deepgram account is out of credit."
            : "Couldn't connect to the transcription service. Please try again.";
    return NextResponse.json({ error }, { status: 502 });
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return NextResponse.json({ token: access_token }, { headers: { "Cache-Control": "no-store" } });
}
