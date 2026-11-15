import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Admin Supabase client using the SECRET key. It bypasses Row Level Security
 * and can read or change any user's data.
 *
 * Use only for trusted server-side jobs (e.g. saving a transcript after a
 * webhook). For anything done on behalf of a user, use ./server instead.
 * The "server-only" import makes the build fail if this file is ever pulled
 * into browser code.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing environment variable SUPABASE_SECRET_KEY.");
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
