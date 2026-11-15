import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Supabase client for Client Components ("use client").
 * Uses the publishable key; every query is limited by Row Level Security
 * to what the signed-in user is allowed to see.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
