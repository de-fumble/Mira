import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user (session read from cookies), so Row Level
 * Security still applies. Create a new one per request — never share it.
 */
export async function createClient() {
  // Supabase reads the clock while it loads the session; tell Next.js this
  // is request-time work so it doesn't try to prerender it.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't write cookies. That's fine: the proxy
          // (src/proxy.ts) refreshes the session on every request instead.
        }
      },
    },
  });
}
