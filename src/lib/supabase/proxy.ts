import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminUser } from "../admin-emails";
import { hasAccess, isBillingExempt, type SubStatus } from "../billing-rules";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Runs before every matched request (see src/proxy.ts). Refreshes the user's
 * Supabase session if it has expired and writes the new auth cookies to both
 * the incoming request (so pages rendered in this request see them) and the
 * outgoing response (so the browser stores them).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache-control headers from Supabase: responses that set auth
        // cookies must never be cached and served to another user.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Don't put code between createServerClient and this call: it's what
  // triggers the refresh. getClaims() verifies the token's signature.
  const { data } = await supabase.auth.getClaims();

  const path = request.nextUrl.pathname;
  const claims = data?.claims;

  // Maintenance mode (switched on from /admin/features): everyone except
  // admins sees the "Back soon" page. Sign-in stays open so admins can get in.
  const { maintenance, billing } = await getSwitches();
  if (path === "/maintenance") {
    return maintenance ? response : redirectKeepingCookies(response, new URL("/", request.url));
  }
  const email = typeof claims?.email === "string" ? claims.email : null;
  const exempt = path.startsWith("/login") || path.startsWith("/auth") || path === "/api/health";
  if (maintenance && claims && !isAdminUser(claims.sub, email) && !exempt) {
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Mira is down for maintenance. Please try again soon." }, { status: 503 });
    }
    return redirectKeepingCookies(response, new URL("/maintenance", request.url));
  }

  // The landing page (public/landing) is open to everyone. Signed-out
  // visitors see it at "/"; anyone can open it at /welcome.
  if (path.startsWith("/landing/")) return response;
  // Opened from the home screen while signed out → straight to sign-in.
  if (!claims && path === "/" && request.nextUrl.searchParams.get("source") === "pwa") {
    return redirectKeepingCookies(response, new URL("/login", request.url));
  }
  if (path === "/welcome" || (!claims && path === "/")) {
    const rewrite = NextResponse.rewrite(new URL("/landing/index.html", request.url));
    for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
    return rewrite;
  }

  // Send signed-out visitors to the sign-in page. API routes answer 401
  // themselves, and the sign-in / email-confirmation pages must stay open.
  const isPublic = path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/api");
  if (!claims && !isPublic) {
    return redirectKeepingCookies(response, new URL("/login", request.url));
  }
  // Already signed in → skip the sign-in page.
  if (claims && path === "/login") {
    return redirectKeepingCookies(response, new URL("/", request.url));
  }

  // Subscriptions (switched on from /admin/features): no free trial or paid
  // month → the billing page. The owner always gets in.
  if (billing && claims && !isAdminUser(claims.sub, email) && !isBillingExempt(path) && !(await canUseMira(claims.sub))) {
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Your Mira subscription isn’t active. Visit Billing to continue." }, { status: 402 });
    }
    return redirectKeepingCookies(response, new URL("/billing", request.url));
  }

  return response;
}

// Switches and subscriptions are read at most every 10 s per server instance,
// so the proxy doesn't add database calls to every request.
let switchCache = { value: { maintenance: false, billing: false }, at: 0 };
const accessCache = new Map<string, { ok: true; at: number }>();

async function rest<T>(path: string): Promise<T | null> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null; // database unreachable → don't lock everyone out
  }
}

async function getSwitches() {
  if (Date.now() - switchCache.at < 10_000) return switchCache.value;
  const rows = await rest<{ key: string; enabled: boolean }[]>("app_settings?key=in.(maintenance,billing)&select=key,enabled");
  const on = (k: string) => Boolean(rows?.find((r) => r.key === k)?.enabled);
  switchCache = { value: { maintenance: on("maintenance"), billing: on("billing") }, at: Date.now() };
  return switchCache.value;
}

async function canUseMira(userId: string): Promise<boolean> {
  const hit = accessCache.get(userId);
  if (hit && Date.now() - hit.at < 10_000) return hit.ok;
  const rows = await rest<{ status: SubStatus; access_until: string | null }[]>(
    `subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=status,access_until`,
  );
  // If the table can't be read (not created yet / database down), let people in.
  const ok = rows === null ? true : hasAccess(rows[0]);
  // Only remember "yes": someone who has just paid must get in straight away.
  if (ok) {
    if (accessCache.size > 5000) accessCache.clear();
    accessCache.set(userId, { ok, at: Date.now() });
  }
  return ok;
}

/** Redirect without dropping any auth cookies or cache headers set above. */
function redirectKeepingCookies(from: NextResponse, to: URL) {
  const redirect = NextResponse.redirect(to);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  const cacheControl = from.headers.get("Cache-Control");
  if (cacheControl) redirect.headers.set("Cache-Control", cacheControl);
  return redirect;
}
