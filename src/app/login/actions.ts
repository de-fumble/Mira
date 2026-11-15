"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getFeatures } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

// `email` is sent back so the form can keep it filled in: React resets a
// form's fields after every submission.
export type AuthState = { error?: string; message?: string; email?: string } | undefined;

function readForm(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readForm(formData);
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      email,
      error:
        error.code === "email_not_confirmed"
          ? "Please confirm your email first — check your inbox for the link."
          : "That email and password don't match. Please try again.",
    };
  }
  redirect("/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readForm(formData);
  if (!email || !password) return { error: "Enter your email and choose a password.", email };
  if (password.length < 8) return { error: "Choose a password of at least 8 characters.", email };
  if (!(await getFeatures()).signups) {
    return { error: "New accounts aren’t being accepted right now. Please check back soon.", email };
  }

  const h = await headers();
  const origin = h.get("origin") ?? `http://${h.get("host")}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message, email };

  // Email confirmation turned off in Supabase → signed in straight away.
  if (data.session) redirect("/");
  return { message: "Almost there — check your email and click the link to confirm your account.", email };
}
