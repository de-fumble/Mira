import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Development-only connection check: GET /api/health
 * Confirms both Supabase keys work and whether the database schema and the
 * recordings bucket exist yet. Returns 404 in production.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const [claims, buckets, meetings] = await Promise.all([
    supabase.auth.getClaims(),
    admin.storage.listBuckets(),
    // Not a HEAD request: HEAD has no body, which hides "table not found".
    admin.from("meetings").select("id").limit(1),
  ]);

  const result = {
    publishableKey: claims.error ? `error: ${claims.error.message}` : "ok",
    signedIn: Boolean(claims.data?.claims),
    secretKey: buckets.error ? `error: ${buckets.error.message}` : "ok",
    recordingsBucket: buckets.data?.some((b) => b.id === "recordings") ?? false,
    meetingsTable: meetings.error ? `missing (${meetings.error.code})` : "ok",
    deepgramKeySet: Boolean(process.env.DEEPGRAM_API_KEY),
    anthropicKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  const ok = result.publishableKey === "ok" && result.secretKey === "ok";
  return NextResponse.json(result, { status: ok ? 200 : 500 });
}
