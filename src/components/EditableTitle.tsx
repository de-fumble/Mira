"use client";

import { Check, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameMeeting } from "@/app/actions";
import { TITLE_MAX } from "@/lib/transcript";
import { Spinner } from "./ui";

/**
 * Meeting title you can rename in place: click it (or the pencil), type,
 * Enter or click away to save, Escape to cancel. Shows the new title
 * immediately and rolls back if saving fails.
 */
export function EditableTitle({ meetingId, initialTitle }: { meetingId: string; initialTitle: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  // Pick up title changes from the server (e.g. the AI naming a new meeting).
  const [lastInitial, setLastInitial] = useState(initialTitle);
  if (initialTitle !== lastInitial && !editing && !pending) {
    setLastInitial(initialTitle);
    setTitle(initialTitle);
    setDraft(initialTitle);
  }

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const startEditing = () => {
    setDraft(title);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(title);
    setError(null);
    setEditing(false);
  };

  const save = () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) {
      setError("The title can’t be empty.");
      input.current?.focus();
      return;
    }
    setEditing(false);
    if (next === title) return;

    const previous = title;
    setTitle(next); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await renameMeeting(meetingId, next);
      if (result.error) {
        setTitle(previous);
        setDraft(previous);
        setError(result.error);
        return;
      }
      setTitle(result.title ?? next);
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1800);
      router.refresh();
    });
  };

  const headingClass = "text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]";

  return (
    <div className="min-w-0">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="meeting-title" className="sr-only">Meeting title</label>
          <input
            ref={input}
            id="meeting-title"
            value={draft}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby="title-hint"
            className={`${headingClass} -mx-2.5 -my-1 w-[calc(100%+20px)] rounded-xl bg-surface px-2.5 py-1 text-ink outline-none shadow-[0_0_0_1px_var(--color-accent),0_0_0_4px_rgb(47_95_208/0.15)]`}
          />
          <p id="title-hint" className="mt-2 text-[13px] text-ink-3">
            Press Enter to save · Esc to cancel
          </p>
        </form>
      ) : (
        <h1 className={`${headingClass} group flex items-start gap-2`}>
          <button
            type="button"
            onClick={startEditing}
            title="Rename meeting"
            className="-mx-2.5 -my-1 min-w-0 rounded-xl px-2.5 py-1 text-left transition-colors hover:bg-hover"
          >
            {title}
          </button>
          <span className="mt-2 flex flex-none items-center sm:mt-3">
            {pending ? (
              <Spinner className="h-5 w-5 text-ink-3" />
            ) : saved ? (
              <span className="inline-flex animate-pop items-center gap-1 text-[13px] font-medium tracking-normal text-success">
                <Check aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                Saved
              </span>
            ) : (
              <button
                type="button"
                onClick={startEditing}
                aria-label="Rename meeting"
                className="tap hover-reveal -m-1.5 grid h-11 w-11 place-items-center rounded-full text-ink-4 transition hover:bg-hover hover:text-ink active:bg-hover sm:m-0 sm:h-8 sm:w-8"
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
            )}
          </span>
        </h1>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[14px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
