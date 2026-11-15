import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isAdminUser } from "./admin-emails";
import { createClient } from "./supabase/server";

/** The signed-in user's id + email, and whether they're an admin (once per request). */
export const getViewer = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  const id = claims?.sub ?? null;
  const meta = (claims?.user_metadata ?? {}) as Record<string, unknown>;
  const username = typeof meta.username === "string" && meta.username.trim() ? meta.username.trim() : null;
  return { id, email, username, isAdmin: isAdminUser(id, email) };
});

/** For admin pages: anyone who isn't an admin gets a plain "not found". */
export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return viewer;
}
