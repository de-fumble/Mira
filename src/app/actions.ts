"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TITLE_MAX } from "@/lib/transcript";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Renames a meeting. RLS limits this to the owner. */
export async function renameMeeting(id: string, rawTitle: string): Promise<{ error?: string; title?: string }> {
  const title = rawTitle.replace(/\s+/g, " ").trim();
  if (!title) return { error: "The title can’t be empty." };
  if (title.length > TITLE_MAX) return { error: `Keep the title under ${TITLE_MAX} characters.` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .update({ title })
    .eq("id", id)
    .select("title")
    .maybeSingle();

  if (error) return { error: "Couldn’t save the new title. Please try again." };
  if (!data) return { error: "This meeting no longer exists." };
  return { title: data.title };
}

/** Deletes a meeting and its audio file. RLS limits this to the owner. */
export async function deleteMeeting(id: string) {
  const supabase = await createClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("audio_path")
    .eq("id", id)
    .maybeSingle();

  if (meeting?.audio_path) {
    await supabase.storage.from("recordings").remove([meeting.audio_path]);
  }
  await supabase.from("meetings").delete().eq("id", id);
  redirect("/");
}
