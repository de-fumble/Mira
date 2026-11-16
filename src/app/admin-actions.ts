"use server";

import { getViewer } from "@/lib/admin";
import { isFeatureKey } from "@/lib/features";
import { runEngineTest, type EngineTestResult } from "@/lib/review-test";
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

/** Sends a sample paragraph through the correction engine. Admins only. */
export async function testCorrectionEngine(): Promise<EngineTestResult> {
  const viewer = await getViewer();
  if (!viewer.isAdmin) return { ok: false, outcome: "failed", error: "Only admins can run a test review.", ms: 0 };
  return runEngineTest(viewer.id);
}
