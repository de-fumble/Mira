"use client";

import { Check, CloudOff, Mic, Square, Trash } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteDocument, dismissIssues, renameDocument, saveDocument } from "@/app/document-actions";
import {
  cleanDictation,
  countWords,
  hashText,
  joinDictated,
  locateIssues,
  scoreFor,
  type DocAnalysis,
  type IssueType,
  type LocatedIssue,
} from "@/lib/documents";
import { ConfirmDialog } from "../ConfirmDialog";
import { DownloadMenu } from "../DownloadMenu";
import { EditableTitle } from "../EditableTitle";
import { Notice, Spinner } from "../ui";
import { ReviewPanel } from "./ReviewPanel";
import { useDictation } from "./useDictation";

type SaveState = "saved" | "unsaved" | "saving" | "error";

// Highlight colours behind flagged words (the text itself is drawn by the textarea).
export const MARK_CLASS: Record<IssueType, string> = {
  spelling: "bg-[#fde3e1] shadow-[inset_0_-2px_0_#e5372b]",
  grammar: "bg-[#fff0cc] shadow-[inset_0_-2px_0_#c98a00]",
  unclear: "bg-[#efe5fa] shadow-[inset_0_-2px_0_#7a3e9d]",
  off_topic: "bg-[#e6ebf3] shadow-[inset_0_-2px_0_#5b6b82]",
};

const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function DocumentEditor({
  doc,
  dictationEnabled,
}: {
  doc: { id: string; title: string; content: string; analysis: DocAnalysis | null };
  dictationEnabled: boolean;
}) {
  const [content, setContentState] = useState(doc.content);
  const [title, setTitle] = useState(doc.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DocAnalysis | null>(doc.analysis);
  const [dismissed, setDismissed] = useState<string[]>(doc.analysis?.dismissed ?? []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "info"; text: string } | null>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(doc.content);
  const savedRef = useRef(doc.content);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const draftRef = useRef<{ start: number; end: number } | null>(null);

  /* ---------------- Saving ---------------- */

  const retryRef = useRef<() => void>(() => {});
  const save = useCallback(async (): Promise<boolean> => {
    // Loop until what's on screen is what's saved (edits can land mid-save).
    for (;;) {
      if (savingRef.current) {
        await savingRef.current;
        continue;
      }
      const text = contentRef.current;
      if (text === savedRef.current) {
        setSaveState("saved");
        return true;
      }
      setSaveState("saving");
      const run = saveDocument(doc.id, { content: text }).then(
        (r) => {
          if (r.error) {
            setSaveError(r.error);
            return false;
          }
          savedRef.current = text;
          setSaveError(null);
          return true;
        },
        () => {
          setSaveError("Couldn’t save. Check your connection — Mira will keep trying.");
          return false;
        },
      );
      savingRef.current = run;
      const ok = await run;
      savingRef.current = null;
      if (!ok) {
        setSaveState("error");
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => retryRef.current(), 5000); // keep trying
        return false;
      }
    }
  }, [doc.id]);
  useEffect(() => {
    retryRef.current = () => void save();
  }, [save]);

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    return save();
  }, [save]);

  const setContent = useCallback(
    (next: string) => {
      contentRef.current = next;
      setContentState(next);
      if (next !== savedRef.current) {
        setSaveState((s) => (s === "error" ? s : "unsaved"));
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => void save(), 1200);
      }
    },
    [save],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flush();
    const onUnload = (e: BeforeUnloadEvent) => {
      if (contentRef.current !== savedRef.current) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      window.clearTimeout(timerRef.current);
    };
  }, [flush]);

  /* ---------------- Dictation ---------------- */

  const updateDraft = (d: { start: number; end: number } | null) => {
    draftRef.current = d;
    setDraft(d);
  };

  const levelRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation({
    documentId: doc.id,
    levelRef,
    onText: (raw) => {
      const d = draftRef.current;
      if (!d) return;
      const text = contentRef.current;
      const before = text.slice(0, d.end);
      const after = text.slice(d.end);
      const piece = joinDictated(before, cleanDictation(raw));
      if (!piece) return;
      // Keep a space between the dictated words and any text after them.
      const gap = /^[\p{L}\p{N}“(]/u.test(after) && !/\s$/.test(piece) ? " " : "";
      setContent(before + piece + gap + after);
      updateDraft({ start: d.start, end: d.end + piece.length });
    },
    onPolished: (polished, message) => {
      const d = draftRef.current;
      updateDraft(null);
      if (polished && d && d.end > d.start) {
        const text = contentRef.current;
        const before = text.slice(0, d.start);
        const piece = joinDictated(before, polished);
        if (piece.trim()) setContent(before + piece + text.slice(d.end));
        setNote({ tone: "success", text: "Done — Mira double-checked the whole recording and tidied the text." });
      } else if (message) {
        setNote({ tone: "info", text: message });
      }
    },
  });
  const listening = dictation.phase === "listening" || dictation.phase === "starting";
  const busyDictating = dictation.phase !== "idle";

  const startDictation = () => {
    setNote(null);
    const ta = textareaRef.current;
    // Dictate where the cursor is (end of the document if it was never placed).
    const caret = ta && document.activeElement === ta ? ta.selectionEnd : contentRef.current.length;
    updateDraft({ start: caret, end: caret });
    void dictation.start().then((started) => {
      if (!started) updateDraft(null);
    });
  };

  /* ---------------- Review ---------------- */

  const located = useMemo<LocatedIssue[]>(
    () => (analysis ? locateIssues(content, analysis.issues.filter((i) => !dismissed.includes(i.id))) : []),
    [analysis, content, dismissed],
  );
  const words = useMemo(() => countWords(content), [content]);
  const liveScore = analysis ? scoreFor(located, words) : null;
  const stale = analysis ? analysis.content_hash !== hashText(content) : false;

  const selectRange = (start: number, end: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    requestAnimationFrame(() => {
      backdropRef.current?.querySelector(`[data-pos="${start}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const focusIssue = (issue: LocatedIssue) => {
    setActiveId(issue.id);
    selectRange(issue.start, issue.end);
  };

  const replaceRange = (start: number, end: number, text: string) => {
    const c = contentRef.current;
    setContent(c.slice(0, start) + text + c.slice(end));
    requestAnimationFrame(() => selectRange(start, start + text.length));
  };

  const applyFix = (issue: LocatedIssue) => {
    if (issue.suggestion === null) return;
    replaceRange(issue.start, issue.end, issue.suggestion);
    setActiveId(null);
  };

  const removeText = (issue: LocatedIssue) => {
    const c = contentRef.current;
    let { start, end } = issue;
    if (c[end] === " ") end++;
    else if (c[start - 1] === " ") start--;
    setContent(c.slice(0, start) + c.slice(end));
    setActiveId(null);
  };

  const dismiss = (issue: LocatedIssue) => {
    setDismissed((d) => [...d, issue.id]);
    void dismissIssues(doc.id, [issue.id]);
  };

  // Caret inside a flagged word → show that issue in the panel.
  const onCaret = () => {
    const ta = textareaRef.current;
    if (!ta || !located.length) return;
    const at = ta.selectionStart;
    const hit = located.find((i) => at >= i.start && at <= i.end);
    if (hit) setActiveId(hit.id);
  };

  /* ---------------- Editor sizing ---------------- */

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [content]);

  // Text behind the textarea, with flagged words (or the live dictation) highlighted.
  const backdrop = useMemo(() => {
    const parts: React.ReactNode[] = [];
    const marks = draft
      ? [{ start: draft.start, end: draft.end, cls: "bg-accent-soft shadow-[inset_0_-2px_0_var(--color-accent)]", id: "draft" }]
      : located.map((i) => ({
          start: i.start,
          end: i.end,
          id: i.id,
          cls: `${MARK_CLASS[i.type]} ${i.id === activeId ? "brightness-90" : ""}`,
        }));
    let pos = 0;
    for (const m of marks) {
      if (m.end <= m.start || m.start < pos) continue;
      parts.push(content.slice(pos, m.start));
      parts.push(
        <mark key={m.id} data-pos={m.start} className={`rounded-[3px] text-transparent ${m.cls}`}>
          {content.slice(m.start, m.end)}
        </mark>,
      );
      pos = m.end;
    }
    parts.push(content.slice(pos));
    parts.push("​"); // keeps a trailing newline's height
    return parts;
  }, [content, located, draft, activeId]);

  const editorText = "px-5 py-6 text-[17px] leading-[1.8] tracking-[-0.003em] sm:px-10 sm:py-9 sm:text-[18px]";

  return (
    <div className="flex flex-col gap-5 pb-40">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <EditableTitle
            initialTitle={title}
            noun="document"
            onRename={async (t) => {
              const r = await renameDocument(doc.id, t);
              if (r.title) setTitle(r.title);
              return r;
            }}
          />
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-3">
            <span className="tabular-nums">
              {words.toLocaleString("en")} {words === 1 ? "word" : "words"}
            </span>
            <SaveStatus state={saveState} error={saveError} />
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <DownloadMenu
            endpoint={`/api/documents/${doc.id}/export`}
            title={title}
            text={`${title}\n\n${content}\n`}
            menuLabel="Download document as"
            beforeDownload={flush}
          />
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-icon btn-danger-ghost sm:h-9! sm:w-9!"
            aria-label="Delete document"
            title="Delete document"
          >
            <Trash aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </header>

      {note && (
        <Notice tone={note.tone} className="py-3">
          <span className="flex items-start justify-between gap-3">
            {note.text}
            <button type="button" onClick={() => setNote(null)} className="text-[13px] font-medium text-ink-3 hover:text-ink">
              Dismiss
            </button>
          </span>
        </Notice>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Document" className="card relative min-h-[60vh] overflow-hidden">
          <div ref={backdropRef} aria-hidden className={`pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-transparent ${editorText}`}>
            {backdrop}
          </div>
          <label htmlFor="doc-body" className="sr-only">
            Document text
          </label>
          <textarea
            id="doc-body"
            ref={textareaRef}
            value={content}
            readOnly={busyDictating}
            spellCheck={!analysis}
            onChange={(e) => setContent(e.target.value)}
            onClick={onCaret}
            onKeyUp={onCaret}
            placeholder={dictationEnabled ? "Press Dictate and start talking — or type here." : "Start typing…"}
            className={`relative block min-h-[60vh] w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent text-ink caret-ink outline-none placeholder:text-ink-4 ${editorText}`}
          />
        </section>

        <ReviewPanel
          documentId={doc.id}
          analysis={analysis}
          located={located}
          dismissedCount={dismissed.length}
          liveScore={liveScore}
          stale={stale}
          words={words}
          activeId={activeId}
          disabled={busyDictating}
          beforeReview={flush}
          onReviewed={(a) => {
            setAnalysis(a);
            setDismissed([]);
            setActiveId(null);
          }}
          onFocus={focusIssue}
          onApply={applyFix}
          onRemove={removeText}
          onDismiss={dismiss}
        />
      </div>

      {/* Dictation dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-safe z-30 flex flex-col items-center gap-3 px-4">
        {listening && dictation.interim && (
          <p className="pointer-events-auto max-w-xl animate-fade-in rounded-2xl bg-ink/90 px-4 py-2.5 text-center text-[15px] leading-snug text-white shadow-[var(--shadow-pop)] backdrop-blur">
            {(() => {
              const shown = cleanDictation(dictation.interim);
              return shown.length > 160 ? `…${shown.slice(-160)}` : shown;
            })()}
          </p>
        )}
        {dictation.error && (
          <p role="alert" className="pointer-events-auto max-w-md rounded-2xl bg-danger-soft px-4 py-2.5 text-center text-[14px] text-danger shadow-[var(--shadow-pop)]">
            {dictation.error}
          </p>
        )}
        <div
          ref={levelRef}
          className="pointer-events-auto flex items-center gap-3 rounded-full bg-surface/95 p-2 pr-5 shadow-[var(--shadow-pop)] backdrop-blur"
        >
          {dictation.phase === "listening" ? (
            <button type="button" onClick={() => void dictation.stop()} className="relative grid h-14 w-14 place-items-center rounded-full bg-rec text-white transition active:scale-95" aria-label="Stop dictating">
              <span aria-hidden className="absolute inset-0 rounded-full bg-rec/30" style={{ transform: "scale(calc(1 + var(--level, 0) * 0.6))", transition: "transform 80ms linear" }} />
              <Square aria-hidden className="relative h-5 w-5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startDictation}
              disabled={!dictationEnabled || busyDictating}
              className="grid h-14 w-14 place-items-center rounded-full bg-ink text-white transition hover:bg-black active:scale-95 disabled:opacity-40"
              aria-label="Start dictating"
            >
              {busyDictating ? <Spinner className="h-5 w-5" /> : <Mic aria-hidden className="h-6 w-6" />}
            </button>
          )}
          <div className="min-w-0 text-left" aria-live="polite">
            <p className="text-[15px] font-semibold leading-tight">
              {dictation.phase === "listening"
                ? `Listening · ${fmtTimer(dictation.seconds)}`
                : dictation.phase === "starting"
                  ? "Starting…"
                  : dictation.phase === "polishing"
                    ? "Checking the recording…"
                    : dictationEnabled
                      ? "Dictate"
                      : "Dictation is off"}
            </p>
            <p className="hidden text-[13px] leading-tight text-ink-3 sm:block">
              {dictation.phase === "listening"
                ? "Say “comma”, “full stop”, “new paragraph”"
                : dictation.phase === "polishing"
                  ? "Improving accuracy — a few seconds"
                  : dictationEnabled
                    ? "Talk — Mira types at your cursor"
                    : "Switched off by the admin for now"}
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this document?"
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => startDelete(() => deleteDocument(doc.id))}
      >
        “{title}” and its review will be permanently removed. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

function SaveStatus({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-danger" role="alert">
        <CloudOff aria-hidden className="h-4 w-4" />
        {error ?? "Not saved"}
      </span>
    );
  }
  if (state === "saving" || state === "unsaved") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Spinner className="h-3.5 w-3.5" />
        Saving…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <Check aria-hidden className="h-4 w-4" />
      Saved
    </span>
  );
}

