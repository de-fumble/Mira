"use client";

import { Upload, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { importDocument } from "@/app/document-actions";
import { ImportError, IMPORT_ACCEPT, readDocumentFile } from "@/lib/import-doc";
import { Spinner } from "../ui";

/**
 * Opens a Word (.docx) or text file as a new Mira document, ready to edit
 * and dictate into. The file is read in the browser; only its text is saved.
 */
export function UploadDocumentButton({
  label = "Upload",
  compact = false,
  align = "right",
  className = "",
}: {
  label?: string;
  /** Just the icon on phones (the documents header). */
  compact?: boolean;
  /** Which edge the error message lines up with. */
  align?: "left" | "right";
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = reading || saving;

  const open = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const doc = await readDocumentFile(file);
      startSaving(async () => {
        const r = await importDocument(doc.title, doc.content, doc.left); // opens the new document when it works
        if (r?.error) setError(r.error);
      });
    } catch (e) {
      setError(e instanceof ImportError ? e.message : "Mira couldn’t open that file.");
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again
          if (file) void open(file);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Open a Word document (.docx) or text file to edit"
        aria-label={compact ? (busy ? "Opening…" : "Upload a document") : undefined}
        className={`btn btn-md btn-secondary ${compact ? "max-sm:w-11 max-sm:px-0" : ""} ${className}`}
      >
        {busy ? <Spinner /> : <Upload aria-hidden className="h-[18px] w-[18px]" />}
        <span className={compact ? "max-sm:hidden" : ""}>{busy ? "Opening…" : label}</span>
      </button>
      {error && (
        <p
          role="alert"
          className={`absolute top-[calc(100%+8px)] z-20 flex w-[min(20rem,calc(100vw-32px))] items-start gap-2 rounded-xl bg-danger-soft py-2.5 pl-3.5 pr-1.5 text-[14px] leading-snug text-danger shadow-[var(--shadow-pop)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="tap -my-1 grid h-8 w-8 flex-none place-items-center rounded-full hover:bg-danger/10">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </p>
      )}
    </div>
  );
}
