"use server";

import { redirect } from "next/navigation";
import { cleanDocTitle, countWords, DOC_MAX_CHARS, type DocAnalysis } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Starts a new, empty document and opens it. RLS fills in user_id. */
export async function createDocument() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").insert({}).select("id").single();
  if (error || !data) redirect("/documents?error=create");
  redirect(`/documents/${data.id}`);
}

/** Autosave: the editor sends the whole text (and/or title). */
export async function saveDocument(
  id: string,
  changes: { content?: string; title?: string },
): Promise<{ error?: string; savedAt?: string; title?: string }> {
  if (!isId(id)) return { error: "This document no longer exists." };
  const update: { content?: string; word_count?: number; title?: string } = {};

  if (changes.content !== undefined) {
    if (changes.content.length > DOC_MAX_CHARS) return { error: "This document is too long to save. Split it into two documents." };
    update.content = changes.content;
    update.word_count = countWords(changes.content);
  }
  if (changes.title !== undefined) {
    const { title, error } = cleanDocTitle(changes.title);
    if (error) return { error };
    update.title = title;
  }
  if (!Object.keys(update).length) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").update(update).eq("id", id).select("title, updated_at").maybeSingle();
  if (error) return { error: "Couldn’t save. Check your connection — Mira will keep trying." };
  if (!data) return { error: "This document no longer exists." };
  return { savedAt: data.updated_at, title: data.title };
}

/** Rename (used by the editable title). */
export async function renameDocument(id: string, rawTitle: string): Promise<{ error?: string; title?: string }> {
  const result = await saveDocument(id, { title: rawTitle });
  return result.error ? { error: result.error } : { title: result.title };
}

/** "Keep as is" on review suggestions. */
export async function dismissIssues(id: string, issueIds: string[]): Promise<{ error?: string }> {
  if (!isId(id)) return { error: "This document no longer exists." };
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("analysis").eq("id", id).maybeSingle<{ analysis: DocAnalysis | null }>();
  if (!data?.analysis) return {};
  const dismissed = [...new Set([...(data.analysis.dismissed ?? []), ...issueIds])];
  const { error } = await supabase.from("documents").update({ analysis: { ...data.analysis, dismissed } }).eq("id", id);
  return error ? { error: "Couldn’t save that. Please try again." } : {};
}

export async function deleteDocument(id: string) {
  if (!isId(id)) redirect("/documents");
  const supabase = await createClient();
  await supabase.from("documents").delete().eq("id", id);
  redirect("/documents");
}
