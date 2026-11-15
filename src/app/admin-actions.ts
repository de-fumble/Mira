"use server";

import { getViewer } from "@/lib/admin";
import { isFeatureKey } from "@/lib/features";
import { createAdminClient } from "@/lib/supabase/admin";

/** Turns one feature on or off. Admins only — checked on every call. */
export async function setFeature(key: string, enabled: boolean): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer.isAdmin) return { error: "Only admins can change features." };
  if (!isFeatureKey(key)) return { error: "Unknown feature." };

  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key, enabled, updated_at: new Date().toISOString(), updated_by: viewer.email });

  if (error) {
    return {
      error: /app_settings|schema cache|does not exist/i.test(error.message)
        ? "The settings table doesn’t exist yet — run supabase/migrations/0002_app_settings.sql first."
        : "Couldn’t save the change. Please try again.",
    };
  }
  return {};
}
