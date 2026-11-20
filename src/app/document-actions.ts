"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cleanDocTitle, countWords, DOC_MAX_CHARS, DOC_TITLE_MAX, type DocAnalysis } from "@/lib/documents";
import { toPlain } from "@/lib/rich-text";
import { createClient } from "@/lib/supabase/server";

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Starts a new, empty document and opens it. RLS fills in user_id. */
export async function createDocument() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").insert({}).select("id").single();
  if (error || !data) redirect("/documents?error=create");
  redirect(`/documents/${data.id}`);
}

/**
 * A document made from an uploaded file (converted in the browser, see
 * lib/import-doc), then opened in the editor.
 */
export async function importDocument(
  rawTitle: string,
  content: string,
  left: { images: number; tables: number } = { images: 0, tables: 0 },
): Promise<{ error?: string }> {
  if (typeof content !== "string" || typeof rawTitle !== "string") return { error: "Couldn’t read that file." };
  if (content.length > DOC_MAX_CHARS) return { error: "This document is too long for Mira (about 50,000 words at most). Split it into smaller files." };
  const words = countWords(toPlain(content));
  if (!words) return { error: "There’s no text in this file for Mira to edit." };
  const { title, error: titleError } = cleanDocTitle(rawTitle.slice(0, DOC_TITLE_MAX));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({ title: titleError ? "Imported document" : title, content, word_count: words })
    .select("id")
    .single();
  if (error || !data) return { error: "Couldn’t add the document. Please try again." };
  revalidatePath("/documents");
  const n = (v: unknown) => Math.max(0, Math.min(999, Math.floor(Number(v)) || 0));
  redirect(`/documents/${data.id}?imported=1&images=${n(left?.images)}&tables=${n(left?.tables)}`);
}

/** Autosave: the editor sends the whole text, with its formatting markers (and/or title). */
export async function saveDocument(
  id: string,
  changes: { content?: string; title?: string },
): Promise<{ error?: string; savedAt?: string; title?: string }> {
  if (!isId(id)) return { error: "This document no longer exists." };
  const update: { content?: string; word_count?: number; title?: string } = {};

  if (changes.content !== undefined) {
    if (changes.content.length > DOC_MAX_CHARS) return { error: "This document is too long to save. Split it into two documents." };
    update.content = changes.content;
    update.word_count = countWords(toPlain(changes.content));
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
  // The documents list shows each one's words, preview and current score: fresh next time it's opened.
  revalidatePath("/documents");
  return { savedAt: data.updated_at, title: data.title };
}

/** Rename (used by the editable title). */
export async function renameDocument(id: string, rawTitle: string): Promise<{ error?: string; title?: string }> {
  const result = await saveDocument(id, { title: rawTitle });
  return result.error ? { error: result.error } : { title: result.title };
}

/**
 * Adds one finished dictation to the document's totals (words that went in,
 * seconds spent talking). Needs supabase/migrations/0006_document_dictation.sql;
 * until that has been run, nothing is kept (and nothing breaks).
 */
export async function addDictation(id: string, words: number, seconds: number): Promise<void> {
  if (!isId(id) || !Number.isFinite(words) || !Number.isFinite(seconds)) return;
  const w = Math.round(words);
  const s = Math.round(seconds);
  if (w <= 0 || w > 50_000 || s < 0 || s > 6 * 3600) return;
  const supabase = await createClient();
  await supabase.rpc("add_document_dictation", { doc: id, words: w, secs: s });
}

/** After a review (which runs in an API route): the documents list shows the new score next time. */
export async function refreshDocumentList(): Promise<void> {
  revalidatePath("/documents");
}

/** "Keep as is" on review suggestions. */
export async function dismissIssues(id: string, issueIds: string[]): Promise<{ error?: string }> {
  if (!isId(id)) return { error: "This document no longer exists." };
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("analysis").eq("id", id).maybeSingle<{ analysis: DocAnalysis | null }>();
  if (!data?.analysis) return {};
  const dismissed = [...new Set([...(data.analysis.dismissed ?? []), ...issueIds])];
  const { error } = await supabase.from("documents").update({ analysis: { ...data.analysis, dismissed } }).eq("id", id);
  if (!error) revalidatePath("/documents"); // "keep as is" changes the score on the list too
  return error ? { error: "Couldn’t save that. Please try again." } : {};
}

export async function deleteDocument(id: string) {
  if (!isId(id)) redirect("/documents");
  const supabase = await createClient();
  await supabase.from("documents").delete().eq("id", id);
  redirect("/documents");
}
