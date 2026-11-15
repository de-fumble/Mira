import "server-only";
import { connection } from "next/server";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";

/** Every feature switch shown on the admin Features page. */
export const FEATURES = [
  {
    key: "recording",
    label: "Recording",
    description: "People can start new recordings with live transcription.",
    default: true,
  },
  {
    key: "ai_notes",
    label: "AI notes",
    description: "Meetings get an automatic summary, decisions and action items.",
    default: true,
  },
  {
    key: "audio_storage",
    label: "Save audio",
    description: "Keep the audio file of each recording so it can be played back. When off, only the transcript is saved.",
    default: true,
  },
  {
    key: "signups",
    label: "New sign-ups",
    description: "New people can create an account. Existing accounts can always sign in.",
    default: true,
  },
  {
    key: "billing",
    label: "Subscriptions",
    description: "People need a subscription to use Mira: a 3-day free trial with a card, then ₦28,800 a month. When off, Mira is free for everyone.",
    default: false, // off until the subscriptions table exists
  },
  {
    key: "maintenance",
    label: "Maintenance mode",
    description: "Everyone except admins sees a “Back soon” screen instead of the app.",
    default: false,
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type Features = Record<FeatureKey, boolean>;
export type FeatureRow = { key: FeatureKey; enabled: boolean; updated_at: string | null; updated_by: string | null };

const DEFAULTS = Object.fromEntries(FEATURES.map((f) => [f.key, f.default])) as Features;

export const isFeatureKey = (k: string): k is FeatureKey => FEATURES.some((f) => f.key === k);

/**
 * Current switch values (deduplicated per request). If the settings table
 * hasn't been created yet, everything falls back to its default, so the app
 * keeps working.
 */
export const getFeatureRows = cache(
  async (): Promise<{ rows: FeatureRow[]; features: Features; tableMissing: boolean }> => {
    await connection(); // always read live values at request time
    const { data, error } = await createAdminClient().from("app_settings").select("key, enabled, updated_at, updated_by");
    const features = { ...DEFAULTS };
    const rows: FeatureRow[] = FEATURES.map((f) => ({ key: f.key, enabled: f.default, updated_at: null, updated_by: null }));
    if (error) return { rows, features, tableMissing: true };

    for (const r of data ?? []) {
      if (!isFeatureKey(r.key)) continue;
      features[r.key] = r.enabled;
      const row = rows.find((x) => x.key === r.key)!;
      Object.assign(row, { enabled: r.enabled, updated_at: r.updated_at, updated_by: r.updated_by });
    }
    return { rows, features, tableMissing: false };
  },
);

export async function getFeatures(): Promise<Features> {
  return (await getFeatureRows()).features;
}
