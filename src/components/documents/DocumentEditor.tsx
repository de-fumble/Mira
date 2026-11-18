"use client";

import { Check, CloudOff, ListChecks, Mic, Pause, Play, Save, Square, Trash } from "lucide-react";
import { Placeholder } from "@tiptap/extensions";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addDictation, deleteDocument, dismissIssues, refreshDocumentList, renameDocument, saveDocument } from "@/app/document-actions";
import { applyDictation, freshDictation, previewDictation, type DictationState } from "@/lib/dictation";
import {
  countWords,
  formatSpan,
  hashText,
  locateIssues,
  scoreFor,
  type DocAnalysis,
  type IssueType,
  type LocatedIssue,
  TYPING_WPM,
  typingSeconds,
} from "@/lib/documents";
import { parseDoc, serializeDoc, toPlain, type Block, type Run } from "@/lib/rich-text";
import { ConfirmDialog } from "../ConfirmDialog";
import { DictationCommands } from "./DictationCommands";
import { FormatToolbar } from "./FormatToolbar";
import { blocksToContent, docModel, FlatLists, Highlights, replaceWithText, setHighlights, toOffset, toPos, type DocModel } from "./rich-editor";
import { DownloadMenu } from "../DownloadMenu";
import { EditableTitle } from "../EditableTitle";
import { Notice, Spinner } from "../ui";
import { ReviewPanel } from "./ReviewPanel";
import { useDictation } from "./useDictation";

type SaveState = "saved" | "unsaved" | "saving" | "error";

// Highlight colours behind flagged words.
export const MARK_CLASS: Record<IssueType, string> = {
  spelling: "bg-[#fde3e1] shadow-[inset_0_-2px_0_#e5372b]",
  grammar: "bg-[#fff0cc] shadow-[inset_0_-2px_0_#c98a00]",
  unclear: "bg-[#efe5fa] shadow-[inset_0_-2px_0_#7a3e9d]",
  off_topic: "bg-[#e6ebf3] shadow-[inset_0_-2px_0_#5b6b82]",
};

const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function DocumentEditor({
  doc,
  dictated: dictatedBefore,
  dictationEnabled,
}: {
  doc: { id: string; title: string; content: string; analysis: DocAnalysis | null };
  /** Words dictated into this document so far, and the seconds spent talking. */
  dictated: { words: number; seconds: number };
  dictationEnabled: boolean;
}) {
  // Saved as text with light formatting markers (lib/rich-text); the review,
  // word count and plain-text download use the words only (`plain`).
  const initialBlocks = useMemo(() => parseDoc(doc.content), [doc.content]);
  const initialStored = useMemo(() => serializeDoc(initialBlocks), [initialBlocks]);
  const [plain, setPlain] = useState(() => toPlain(doc.content));
  const [title, setTitle] = useState(doc.title);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DocAnalysis | null>(doc.analysis);
  const [dismissed, setDismissed] = useState<string[]>(doc.analysis?.dismissed ?? []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "info"; text: string } | null>(null);
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dictated, setDictated] = useState(dictatedBefore);
  const [deleting, startDelete] = useTransition();

  const contentRef = useRef(initialStored);
  const savedRef = useRef(initialStored); // opening an old plain-text document doesn't re-save it
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const draftRef = useRef<{ from: number; to: number } | null>(null); // editor positions

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
      // Leaving the document (Next.js hides the editor): save what's pending
      // now instead of dropping it.
      void flush();
    };
  }, [flush]);

  // ⌘S / Ctrl+S saves now (instead of the browser's "Save page").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  /* ---------------- Editor ---------------- */

  const modelRef = useRef<DocModel | null>(null);
  const touchedRef = useRef(false); // the cursor was placed in the document
  const handlers = useRef({ update: () => {}, caret: () => {} });
  const editorText = "px-5 py-6 text-[17px] leading-[1.8] tracking-[-0.003em] sm:px-10 sm:py-8 sm:text-[18px]";
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
        dropcursor: false,
      }),
      Placeholder.configure({ placeholder: dictationEnabled ? "Press Dictate and start talking — or type here." : "Start typing…" }),
      Highlights,
      FlatLists,
    ],
    content: blocksToContent(initialBlocks),
    editorProps: {
      attributes: { id: "doc-body", "aria-label": "Document text", class: `doc-prose min-h-[60vh] outline-none ${editorText}` },
      // Keep the cursor clear of the header and the dictation controls.
      scrollMargin: { top: 140, bottom: 200, left: 0, right: 0 },
      scrollThreshold: { top: 140, bottom: 200, left: 0, right: 0 },
    },
    onCreate: ({ editor: e }) => {
      modelRef.current = docModel(e.state.doc);
    },
    onUpdate: () => handlers.current.update(),
    onSelectionUpdate: () => handlers.current.caret(),
    onFocus: () => {
      touchedRef.current = true;
    },
  });

  // What's on screen → saved text + plain words.
  const syncFromEditor = () => {
    if (!editor) return;
    const m = docModel(editor.state.doc);
    modelRef.current = m;
    setPlain(m.plain);
    setContent(serializeDoc(m.blocks));
  };

  /* ---------------- Dictation ---------------- */

  const updateDraft = (d: { from: number; to: number } | null) => {
    draftRef.current = d;
    setDraft(d);
  };

  // Everything said in this dictation, with the voice commands applied. The
  // draft range in the document is replaced with its text after each phrase.
  const spokenRef = useRef<DictationState>(freshDictation());
  const draftTextRef = useRef(""); // what's in the draft range now
  const [caps, setCaps] = useState(false);

  const levelRef = useRef<HTMLDivElement>(null);
  const dictation = useDictation({
    documentId: doc.id,
    levelRef,
    onText: (raw) => {
      const d = draftRef.current;
      if (!d || !editor) return;
      const before = editor.state.doc.textBetween(0, d.from, "\n\n", "\n");
      const { state, pause, end } = applyDictation(spokenRef.current, raw, before);
      spokenRef.current = state;
      setCaps(state.caps);
      if (state.text !== draftTextRef.current) {
        const tr = editor.state.tr;
        const to = replaceWithText(tr, d.from, d.to, state.text);
        // Keep a space between the dictated words and any text after them.
        const next = tr.doc.textBetween(to, Math.min(tr.doc.resolve(to).end(), to + 1));
        if (state.text && !/\s$/.test(state.text) && /^[\p{L}\p{N}“(]/u.test(next)) tr.insertText(" ", to);
        // Follow the newest words down the page.
        tr.setSelection(TextSelection.near(tr.doc.resolve(to))).scrollIntoView();
        editor.view.dispatch(tr);
        draftTextRef.current = state.text;
        updateDraft({ from: d.from, to });
      }
      if (end) void dictation.stop();
      else if (pause) dictation.pause();
    },
    onPolished: (raw, message, seconds) => {
      const d = draftRef.current;
      const live = spokenRef.current;
      updateDraft(null);
      draftTextRef.current = "";
      spokenRef.current = freshDictation();
      setCaps(false);
      let kept = live.text; // what this dictation put in the document
      if (raw && d && editor) {
        const before = editor.state.doc.textBetween(0, d.from, "\n\n", "\n");
        const { state } = applyDictation(freshDictation(), raw, before);
        // The second pass must have caught every command the live one did
        // (otherwise "scratch that" could come back as words), and found text if there was some.
        if (state.commands >= live.commands && (state.text.trim() || !live.text.trim())) {
          const tr = editor.state.tr;
          replaceWithText(tr, d.from, d.to, state.text);
          editor.view.dispatch(tr);
          kept = state.text;
          setNote({ tone: "success", text: "Done — Mira double-checked the whole recording and tidied the text." });
        } else {
          setNote({ tone: "success", text: "Done — your dictation is in the document." });
        }
      } else if (message) {
        setNote({ tone: "info", text: message });
      }
      // Dictating vs typing: add this dictation to the document's totals.
      const spoken = countWords(kept);
      if (spoken > 0) {
        setDictated((t) => ({ words: t.words + spoken, seconds: t.seconds + seconds }));
        void addDictation(doc.id, spoken, seconds).catch(() => {});
      }
    },
  });
  const phase = dictation.phase;
  const listening = phase === "listening" || phase === "starting";
  const active = listening || phase === "paused";
  const busyDictating = phase !== "idle";

  // Voice commands panel on phones and tablets (wide screens show it beside the document).
  // Remembered per device; read when dictation starts.
  const [showCommands, setShowCommands] = useState(true);
  const toggleCommands = (show: boolean) => {
    setShowCommands(show);
    try {
      localStorage.setItem("mira.dictation.commands", show ? "shown" : "hidden");
    } catch {
      /* storage unavailable */
    }
  };

  const startDictation = () => {
    if (!editor) return;
    setNote(null);
    // Dictate where the cursor is (end of the document if it was never placed).
    const { selection, doc: pm } = editor.state;
    const caret = touchedRef.current ? selection.to : Selection.atEnd(pm).from;
    updateDraft({ from: caret, to: caret });
    draftTextRef.current = "";
    spokenRef.current = freshDictation();
    setCaps(false);
    try {
      setShowCommands(localStorage.getItem("mira.dictation.commands") !== "hidden");
    } catch {
      /* storage unavailable */
    }
    void dictation.start().then((started) => {
      if (!started) updateDraft(null);
    });
  };

  /* ---------------- Review ---------------- */

  const located = useMemo<LocatedIssue[]>(
    () => (analysis ? locateIssues(plain, analysis.issues.filter((i) => !dismissed.includes(i.id))) : []),
    [analysis, plain, dismissed],
  );
  const words = useMemo(() => countWords(plain), [plain]);
  const liveScore = analysis ? scoreFor(located, words) : null;
  const stale = analysis ? analysis.content_hash !== hashText(plain) : false;

  /** Selects plain-text offsets start…end in the editor and scrolls them to the middle of the screen. */
  const selectRange = (start: number, end: number) => {
    if (!editor) return;
    const m = (modelRef.current ??= docModel(editor.state.doc));
    const from = toPos(m, start);
    editor.chain().focus(null, { scrollIntoView: false }).setTextSelection({ from, to: toPos(m, end, "end") }).run();
    requestAnimationFrame(() => {
      const top = editor.view.coordsAtPos(from).top;
      window.scrollTo({ top: window.scrollY + top - window.innerHeight / 2, behavior: "smooth" });
    });
  };

  const focusIssue = (issue: LocatedIssue) => {
    setActiveId(issue.id);
    selectRange(issue.start, issue.end);
  };

  /** Replaces plain-text offsets start…end (keeps the formatting around it). */
  const replaceRange = (start: number, end: number, text: string) => {
    if (!editor) return;
    const m = (modelRef.current ??= docModel(editor.state.doc));
    const from = toPos(m, start);
    const to = toPos(m, end, "end");
    editor.view.dispatch(text ? editor.state.tr.insertText(text, from, to) : editor.state.tr.delete(from, to));
    if (text) requestAnimationFrame(() => selectRange(start, start + text.length));
  };

  const applyFix = (issue: LocatedIssue) => {
    if (issue.suggestion === null) return;
    replaceRange(issue.start, issue.end, issue.suggestion);
    setActiveId(null);
    void flush(); // saved now, so the new score is on the documents list straight away
  };

  const removeText = (issue: LocatedIssue) => {
    let { start, end } = issue;
    if (plain[end] === " ") end++;
    else if (plain[start - 1] === " ") start--;
    replaceRange(start, end, "");
    setActiveId(null);
    void flush();
  };

  const dismiss = (issue: LocatedIssue) => {
    setDismissed((d) => [...d, issue.id]);
    void dismissIssues(doc.id, [issue.id]);
  };

  // Caret inside a flagged word → show that issue in the panel.
  const onCaret = () => {
    const m = modelRef.current;
    if (!editor || !m || !located.length) return;
    const at = toOffset(m, editor.state.selection.from);
    const hit = located.find((i) => at >= i.start && at <= i.end);
    if (hit) setActiveId(hit.id);
  };

  useEffect(() => {
    handlers.current = { update: syncFromEditor, caret: onCaret };
  });

  // Read-only while dictating; spellcheck off once reviewed (the review's highlights take over).
  useEffect(() => {
    editor?.setEditable(!busyDictating, false);
  }, [editor, busyDictating]);
  useEffect(() => {
    if (editor) editor.view.dom.spellcheck = !analysis;
  }, [editor, analysis]);

  // Flagged words (or the words being dictated) highlighted in the text.
  useEffect(() => {
    if (!editor) return;
    const m = (modelRef.current ??= docModel(editor.state.doc)); // (the editor may not have reported in yet)
    setHighlights(
      editor.view,
      draft
        ? [{ id: "draft", from: draft.from, to: draft.to, className: "rounded-[3px] bg-accent-soft shadow-[inset_0_-2px_0_var(--color-accent)]" }]
        : located.map((i) => ({
            id: i.id,
            from: toPos(m, i.start),
            to: toPos(m, i.end, "end"),
            className: `rounded-[3px] ${MARK_CLASS[i.type]} ${i.id === activeId ? "brightness-90" : ""}`,
          })),
    );
  }, [editor, located, draft, activeId]);

  return (
    <div className={`flex flex-col gap-5 pb-40 ${active && showCommands ? "max-lg:pb-[calc(10rem+40dvh)]" : ""}`}>
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
            <DictationSavings words={dictated.words} seconds={dictated.seconds} />
            {saveState === "error" && (
              <span className="inline-flex items-center gap-1 text-danger" role="alert">
                <CloudOff aria-hidden className="h-4 w-4" />
                {saveError ?? "Not saved"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <SaveButton state={saveState} onSave={() => void flush()} />
          <div data-tour="doc-download">
            <DownloadMenu
              endpoint={`/api/documents/${doc.id}/export`}
              title={title}
              text={`${title}\n\n${plain}\n`}
              menuLabel="Download document as"
              beforeDownload={flush}
            />
          </div>
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
        <section aria-label="Document" className="card relative min-h-[60vh] overflow-clip">
          <FormatToolbar editor={editor} disabled={busyDictating} />
          {editor ? <EditorContent editor={editor} /> : <StaticDoc blocks={initialBlocks} className={`doc-prose ${editorText}`} />}
        </section>

        {active && (
          <div className="card hidden p-5 lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
            <DictationCommands caps={caps} />
          </div>
        )}
        {/* Kept mounted while dictating (a review may still be finishing). */}
        <div className={active ? "contents lg:hidden" : "contents"}>
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
              void refreshDocumentList().catch(() => {});
              setDismissed([]);
              setActiveId(null);
            }}
            onFocus={focusIssue}
            onApply={applyFix}
            onRemove={removeText}
            onDismiss={dismiss}
          />
        </div>
      </div>

      {/* Dictation dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-safe z-30 flex flex-col items-center gap-3 px-4">
        {active && showCommands && (
          <div className="pointer-events-auto max-h-[40dvh] w-full max-w-md animate-fade-in overflow-y-auto rounded-2xl bg-surface/95 p-4 shadow-[var(--shadow-pop)] backdrop-blur lg:hidden">
            <DictationCommands caps={caps} onClose={() => toggleCommands(false)} />
          </div>
        )}
        {listening && dictation.interim && (
          <p className="pointer-events-auto max-w-xl animate-fade-in rounded-2xl bg-ink/90 px-4 py-2.5 text-center text-[15px] leading-snug text-white shadow-[var(--shadow-pop)] backdrop-blur">
            {(() => {
              const shown = previewDictation(dictation.interim, caps);
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
          data-tour={dictationEnabled ? "doc-dictate" : undefined}
          className={`pointer-events-auto flex items-center gap-3 rounded-full bg-surface/95 p-2 shadow-[var(--shadow-pop)] backdrop-blur ${active ? "pr-2" : "pr-5"}`}
        >
          {phase === "listening" || phase === "paused" ? (
            <button type="button" onClick={() => void dictation.stop()} className="relative grid h-14 w-14 flex-none place-items-center rounded-full bg-rec text-white transition active:scale-95" aria-label="Stop dictating">
              <span aria-hidden className="absolute inset-0 rounded-full bg-rec/30" style={{ transform: "scale(calc(1 + var(--level, 0) * 0.6))", transition: "transform 80ms linear" }} />
              <Square aria-hidden className="relative h-5 w-5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startDictation}
              disabled={!dictationEnabled || busyDictating}
              className="grid h-14 w-14 flex-none place-items-center rounded-full bg-ink text-white transition hover:bg-black active:scale-95 disabled:opacity-40"
              aria-label="Start dictating"
            >
              {busyDictating ? <Spinner className="h-5 w-5" /> : <Mic aria-hidden className="h-6 w-6" />}
            </button>
          )}
          <div className="min-w-0 text-left" aria-live="polite">
            <p className="flex items-center gap-2 text-[15px] font-semibold leading-tight">
              {phase === "listening"
                ? `Listening · ${fmtTimer(dictation.seconds)}`
                : phase === "paused"
                  ? `Paused · ${fmtTimer(dictation.seconds)}`
                  : phase === "starting"
                    ? "Starting…"
                    : phase === "polishing"
                      ? "Checking the recording…"
                      : dictationEnabled
                        ? "Dictate"
                        : "Dictation is off"}
              {active && caps && (
                <span className="rounded bg-accent px-1.5 py-px text-[11px] font-bold tracking-[0.06em] text-white" title="Typing in capitals — say “caps off” to stop">
                  CAPS
                </span>
              )}
            </p>
            <p className="hidden text-[13px] leading-tight text-ink-3 sm:block">
              {phase === "listening"
                ? "Say “pause dictation” or “end dictation”"
                : phase === "paused"
                  ? "Mira isn’t listening — tap Resume"
                  : phase === "polishing"
                    ? "Improving accuracy — a few seconds"
                    : dictationEnabled
                      ? "Talk — Mira types at your cursor"
                      : "Switched off by the admin for now"}
            </p>
          </div>
          {(phase === "listening" || phase === "paused") && (
            <button
              type="button"
              onClick={phase === "paused" ? dictation.resume : dictation.pause}
              className={`grid h-11 w-11 flex-none place-items-center rounded-full transition active:scale-95 ${
                phase === "paused" ? "bg-ink text-white hover:bg-black" : "bg-ink/5 text-ink hover:bg-ink/10"
              }`}
              aria-label={phase === "paused" ? "Resume dictating" : "Pause dictating"}
              title={phase === "paused" ? "Resume" : "Pause"}
            >
              {phase === "paused" ? <Play aria-hidden className="h-5 w-5 fill-current" /> : <Pause aria-hidden className="h-5 w-5 fill-current" />}
            </button>
          )}
          {active && (
            <button
              type="button"
              onClick={() => toggleCommands(!showCommands)}
              className={`grid h-11 w-11 flex-none place-items-center rounded-full transition active:scale-95 lg:hidden ${
                showCommands ? "bg-accent-soft text-accent" : "bg-ink/5 text-ink hover:bg-ink/10"
              }`}
              aria-label={showCommands ? "Hide voice commands" : "Show voice commands"}
              aria-pressed={showCommands}
            >
              <ListChecks aria-hidden className="h-5 w-5" />
            </button>
          )}
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

/** Saves edits now. Mira also saves on its own a moment after you stop typing; this shows where that's at. */
function SaveButton({ state, onSave }: { state: SaveState; onSave: () => void }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Try again" : "Save";
  return (
    <button
      type="button"
      onClick={onSave}
      aria-disabled={state === "saving" || state === "saved"}
      title={state === "saved" ? "All changes saved" : `Save changes (${mac ? "⌘S" : "Ctrl+S"})`}
      className={`btn btn-sm min-w-[6.5rem] ${state === "unsaved" || state === "error" ? "btn-primary" : "btn-secondary text-ink-2"}`}
    >
      {state === "saving" ? <Spinner /> : state === "saved" ? <Check aria-hidden className="h-4 w-4 text-success" /> : <Save aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}

/** How long the dictated words took to say, against typing them. */
function DictationSavings({ words, seconds }: { words: number; seconds: number }) {
  if (words <= 0) return null;
  const typing = typingSeconds(words);
  const saved = typing - seconds;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums"
      title={`Compared with typing at ${TYPING_WPM} words a minute, an average typing speed.`}
    >
      <Mic aria-hidden className="h-3.5 w-3.5 flex-none" />
      <span>
        {words.toLocaleString("en")} dictated in {formatSpan(seconds)}
      </span>
      <span aria-hidden>·</span>
      <span>typing would take about {formatSpan(typing)}</span>
      {saved >= 1 && (
        <>
          <span aria-hidden>·</span>
          <span className="font-medium text-success">{formatSpan(saved)} saved</span>
        </>
      )}
    </span>
  );
}

/** The document before the editor has loaded (same look, not editable yet). */
function StaticDoc({ blocks, className }: { blocks: Block[]; className: string }) {
  const runs = (rs: Run[]) =>
    rs.map((r, i) => {
      let node: React.ReactNode = r.text.split("\n").flatMap((t, j) => (j ? [<br key={j} />, t] : [t]));
      if (r.marks.includes("u")) node = <u>{node}</u>;
      if (r.marks.includes("i")) node = <em>{node}</em>;
      if (r.marks.includes("b")) node = <strong>{node}</strong>;
      return <span key={i}>{node}</span>;
    });
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "ul" || b.type === "ol") {
      const items: Block[] = [];
      while (blocks[i]?.type === b.type) items.push(blocks[i++]);
      i--;
      const List = b.type === "ul" ? "ul" : "ol";
      out.push(
        <List key={i}>
          {items.map((it, k) => (
            <li key={k}>
              <p>{runs(it.runs)}</p>
            </li>
          ))}
        </List>,
      );
    } else {
      const Tag = b.type === "h1" ? "h1" : b.type === "h2" ? "h2" : "p";
      out.push(<Tag key={i}>{runs(b.runs)}</Tag>);
    }
  }
  return <div className={`min-h-[60vh] ${className}`}>{out.length ? out : <p />}</div>;
}
