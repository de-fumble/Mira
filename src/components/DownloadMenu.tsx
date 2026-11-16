"use client";

import { ChevronDown, Download, FileText, FileType } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

/**
 * "Download ▾" with Word, PDF and plain text. Word and PDF are built by
 * `endpoint?format=…`; text is made in the browser from `text`.
 * `beforeDownload` runs first (e.g. to save unsaved edits).
 */
export function DownloadMenu({
  endpoint,
  title,
  text,
  menuLabel = "Download as",
  beforeDownload,
}: {
  endpoint: string;
  title: string;
  text: string;
  menuLabel?: string;
  beforeDownload?: () => Promise<boolean | void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const download = async (format: Format) => {
    setOpen(false);
    setError(null);
    if (format === "txt") {
      saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${title}.txt`);
      return;
    }
    setBusy(format);
    try {
      if ((await beforeDownload?.()) === false) throw new Error("Couldn’t save your latest changes. Please try again.");
      const res = await fetch(`${endpoint}?format=${format}`);
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-sm btn-secondary"
      >
        {busy ? <Spinner /> : <Download aria-hidden className="h-4 w-4" />}
        {busy ? `Preparing ${busy === "docx" ? "Word" : "PDF"}…` : "Download"}
        {!busy && <ChevronDown aria-hidden className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-60 origin-top-left animate-pop rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-pop)] sm:left-auto sm:right-0 sm:origin-top-right"
        >
          <p className="px-3 pb-1.5 pt-2 text-[12px] font-medium text-ink-3">{menuLabel}</p>
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
      {error && (
        <p role="alert" className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 rounded-xl sm:left-auto sm:right-0 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
