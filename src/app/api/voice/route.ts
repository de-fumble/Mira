import { NextResponse } from "next/server";

/**
 * GET /api/voice?voice=athena&text=Hello — speaks short text with one of
 * Deepgram's natural Aura-2 voices (used by the landing page demos).
 *
 * It's public, so it is deliberately small: a fixed list of voices, short
 * text only, same-site requests only, and per-visitor + daily caps so the
 * Deepgram bill can't run away. Answers are cached by the browser/CDN.
 */

// Keep in sync with VOICES in public/landing/assets/js/main.js.
const VOICES = new Set(["athena", "helena", "vesta", "pandora", "draco", "mars", "orion", "hyperion"]);
const MAX_CHARS = 300;

const WINDOW_MS = 10 * 60_000;
const PER_VISITOR = 30; // requests per visitor per 10 minutes
const PER_DAY = 600; // requests per server per day (about 1 US cent each)

const hits = new Map<string, number[]>();
let today = { day: "", count: 0 };

function allow(visitor: string) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (today.day !== day) today = { day, count: 0 };
  if (today.count >= PER_DAY) return false;

  const recent = (hits.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_VISITOR) return false;
  recent.push(now);
  if (hits.size > 10_000) hits.clear();
  hits.set(visitor, recent);
  today.count++;
  return true;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const voice = params.get("voice") ?? "";
  const text = (params.get("text") ?? "").replace(/\s+/g, " ").trim();

  if (!VOICES.has(voice)) return NextResponse.json({ error: "Unknown voice." }, { status: 400 });
  if (!text || text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Text must be 1–${MAX_CHARS} characters.` }, { status: 400 });
  }
  // Browsers say where a request came from; only Mira's own pages may use this.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  if (!allow(visitor)) {
    return NextResponse.json({ error: "Too many requests — try again in a few minutes." }, { status: 429, headers: { "Retry-After": "600" } });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Voices aren't set up." }, { status: 503 });

  const res = await fetch(`https://api.deepgram.com/v1/speak?model=aura-2-${voice}-en&encoding=mp3`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    console.error("Deepgram speak failed", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "Couldn't create the voice." }, { status: 502 });
  }

  // Stream the audio straight through so playback starts right away.
  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
