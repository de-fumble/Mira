"use server";

import { isTourId, toursSeen } from "@/lib/tour";
import { createClient } from "@/lib/supabase/server";

/** Remembers that the signed-in user has finished (or skipped) a tour, so it doesn't start again. */
export async function markTourSeen(id: string): Promise<void> {
  if (!isTourId(id)) return;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const seen = toursSeen(data.user.user_metadata);
  if (seen.includes(id)) return;
  const { error } = await supabase.auth.updateUser({ data: { tours: [...seen, id] } });
  // The list is read from the session token, so get a fresh one that includes it.
  if (!error) await supabase.auth.refreshSession();
}
