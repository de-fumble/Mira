"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { PASSWORD_MIN, cleanUsername } from "@/lib/account";
import { getViewer } from "@/lib/admin";
import { getSubscription } from "@/lib/billing";
import { paystack } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string; at?: number } | undefined;

/** Saves the username in the user's profile (Supabase user metadata). */
export async function updateUsername(_prev: FormState, formData: FormData): Promise<FormState> {
  const { name, error } = cleanUsername(String(formData.get("username") ?? ""));
  if (error) return { error };

  const supabase = await createClient();
  const { error: saveError } = await supabase.auth.updateUser({ data: { username: name } });
  if (saveError) return { error: "Couldn’t save your username. Please try again." };
  // The name is read from the session token, so get a fresh one that includes it.
  await supabase.auth.refreshSession();
  refresh(); // so the header and greeting show the new name straight away
  return { ok: "Username saved.", at: Date.now() };
}

/** Changes the password after checking the current one. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { error: "Fill in your current and new password." };
  if (next.length < PASSWORD_MIN) return { error: `Choose a new password of at least ${PASSWORD_MIN} characters.` };
  if (next !== confirm) return { error: "The new passwords don’t match." };
  if (next === current) return { error: "Your new password must be different from the current one." };

  const viewer = await getViewer();
  if (!viewer.email) return { error: "Please sign in again." };

  // Check the current password on a throwaway client so the browser's session isn't touched.
  const checker = createPlainClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: wrong } = await checker.auth.signInWithPassword({ email: viewer.email, password: current });
  if (wrong) return { error: "Your current password isn’t right." };
  await checker.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return {
      error:
        error.code === "weak_password"
          ? "That password is too easy to guess. Try a longer one."
          : error.code === "same_password"
            ? "Your new password must be different from the current one."
            : "Couldn’t change your password. Please try again.",
    };
  }
  return { ok: "Password changed. Use your new password next time you sign in.", at: Date.now() };
}

/**
 * Permanently deletes the signed-in user's account: every recording file,
 * every meeting (removed with the account by the database) and the login.
 */
export async function deleteAccount(confirmEmail: string): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer.id || !viewer.email) return { error: "Please sign in again." };
  if (confirmEmail.trim().toLowerCase() !== viewer.email.toLowerCase()) {
    return { error: "Type your email exactly as shown to confirm." };
  }
  if (viewer.isAdmin) {
    return { error: "This is the owner account that runs Mira, so it can’t be deleted from here." };
  }

  const admin = createAdminClient();

  // 0. Stop the Paystack subscription so the card is never charged again.
  const { sub } = await getSubscription(viewer.id);
  if (sub?.subscription_code && sub.email_token && sub.status !== "cancelled") {
    try {
      await paystack.disable(sub.subscription_code, sub.email_token);
    } catch {
      // Already cancelled on Paystack's side is fine; anything else must stop the deletion.
      const fresh = await paystack.getSubscription(sub.subscription_code).catch(() => null);
      if (!fresh || !["cancelled", "completed", "non-renewing"].includes(fresh.status)) {
        return { error: "Couldn’t cancel your subscription with Paystack, so nothing was deleted. Please try again." };
      }
    }
  }

  // 1. Audio files in the user's folder (listed in pages of 1,000).
  for (;;) {
    const { data: files, error } = await admin.storage.from("recordings").list(viewer.id, { limit: 1000 });
    if (error) return { error: "Couldn’t delete your recordings. Nothing was removed — please try again." };
    if (!files.length) break;
    const { error: rmError } = await admin.storage.from("recordings").remove(files.map((f) => `${viewer.id}/${f.name}`));
    if (rmError) return { error: "Couldn’t delete your recordings. Please try again." };
    if (files.length < 1000) break;
  }

  // 2. End the session in this browser, then remove the account (meetings go with it).
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { error } = await admin.auth.admin.deleteUser(viewer.id);
  if (error) return { error: "Couldn’t delete your account. Please sign in and try again." };

  redirect("/login?deleted=1");
}
