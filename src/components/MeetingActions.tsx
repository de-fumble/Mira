"use client";

import { Check, ChevronDown, Copy, Download, FileText, FileType, Trash } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteMeeting } from "@/app/actions";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./ui";

type Format = "docx" | "pdf" | "txt";

const FORMATS: { format: Format; label: string; hint: string; Icon: typeof FileText }[] = [
  { format: "docx", label: "Word document", hint: ".docx", Icon: FileText },
  { format: "pdf", label: "PDF", hint: ".pdf", Icon: FileType },
  { format: "txt", label: "Plain text", hint: ".txt", Icon: FileText },
];

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads the file name the server chose (filename*=UTF-8''…). */
function filenameFrom(res: Response, fallback: string) {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) return decodeURIComponent(star);
  return cd.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** Copy / download (Word, PDF, text) / delete for one meeting. */
export function MeetingActions({ meetingId, title, text }: { meetingId: string; title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const exportText = `${title}\n\n${text}\n`;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const copy = async () => {
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const download = async (format: Format) => {
    setMenuOpen(false);
    setError(null);
    if (format === "txt") {
      saveBlob(new Blob([exportText], { type: "text/plain;charset=utf-8" }), `${title}.txt`);
      return;
    }
    setBusy(format);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/export?format=${format}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn’t create the file.");
      }
      saveBlob(await res.blob(), filenameFrom(res, `${title}.${format}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t create the file.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {text && (
          <>
            <button type="button" onClick={copy} className="btn btn-sm btn-secondary" aria-live="polite">
              {copied ? <Check aria-hidden className="h-4 w-4 animate-pop text-success" /> : <Copy aria-hidden className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={busy !== null}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="btn btn-sm btn-secondary"
              >
                {busy ? <Spinner /> : <Download aria-hidden className="h-4 w-4" />}
                {busy ? `Preparing ${busy === "docx" ? "Word" : "PDF"}…` : "Download"}
                {!busy && <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Download as"
                  className="absolute left-0 top-[calc(100%+6px)] z-30 w-60 origin-top-left animate-pop rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-pop)] sm:left-auto sm:right-0 sm:origin-top-right"
                >
                  <p className="px-3 pb-1.5 pt-2 text-[12px] font-medium text-ink-3">Download transcript as</p>
                  {FORMATS.map(({ format, label, hint, Icon }) => (
                    <button
                      key={format}
                      role="menuitem"
                      type="button"
                      onClick={() => download(format)}
                      className="tap flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] font-medium text-ink-2 transition hover:bg-sunken hover:text-ink sm:h-10 sm:text-[14px]"
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                      <span className="flex-1">{label}</span>
                      <span className="text-[12px] text-ink-4">{hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn btn-icon btn-danger-ghost sm:h-9! sm:w-9!"
          aria-label="Delete meeting"
          title="Delete meeting"
        >
          <Trash aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Delete this meeting?"
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onClose={() => setConfirming(false)}
        onConfirm={() => startDelete(() => deleteMeeting(meetingId))}
      >
        The recording, transcript and notes will be permanently removed. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}
