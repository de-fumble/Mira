"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Bold, Heading1, Heading2, Italic, List, ListOrdered, Redo2, RemoveFormatting, Underline, Undo2 } from "lucide-react";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * A few formatting tools above the document: bold, italic, underline,
 * headings, lists. Enough for letters, minutes and short reports.
 */
export function FormatToolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            bullets: e.isActive("bulletList"),
            numbers: e.isActive("orderedList"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  const off = disabled || !editor;
  const key = isMac() ? "⌘" : "Ctrl+";
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-tour="doc-format"
      className="sticky top-[calc(3.5rem+1px+env(safe-area-inset-top))] z-10 flex items-center overflow-x-auto sm:gap-0.5 border-b border-line bg-surface/90 px-2 py-1.5 backdrop-blur [scrollbar-width:none] sm:top-[calc(4rem+1px+env(safe-area-inset-top))] sm:px-5"
    >
      <Tool label="Bold" hint={`${key}B`} active={s?.bold} disabled={off} onClick={run((e) => e.chain().focus().toggleBold().run())}>
        <Bold aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.4} />
      </Tool>
      <Tool label="Italic" hint={`${key}I`} active={s?.italic} disabled={off} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
        <Italic aria-hidden className="h-[18px] w-[18px]" />
      </Tool>
      <Tool label="Underline" hint={`${key}U`} active={s?.underline} disabled={off} onClick={run((e) => e.chain().focus().toggleUnderline().run())}>
        <Underline aria-hidden className="h-[18px] w-[18px]" />
      </Tool>
      <Divider />
      <Tool label="Heading" active={s?.h1} disabled={off} onClick={run((e) => e.chain().focus().toggleHeading({ level: 1 }).run())}>
        <Heading1 aria-hidden className="h-5 w-5" />
      </Tool>
      <Tool label="Subheading" active={s?.h2} disabled={off} onClick={run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}>
        <Heading2 aria-hidden className="h-5 w-5" />
      </Tool>
      <Divider />
      <Tool label="Bulleted list" active={s?.bullets} disabled={off} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
        <List aria-hidden className="h-5 w-5" />
      </Tool>
      <Tool label="Numbered list" active={s?.numbers} disabled={off} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
        <ListOrdered aria-hidden className="h-5 w-5" />
      </Tool>
      <Divider />
      <Tool label="Clear formatting" disabled={off} onClick={run((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}>
        <RemoveFormatting aria-hidden className="h-[18px] w-[18px]" />
      </Tool>
      <span className="ml-auto flex items-center gap-0.5 max-sm:hidden">
        <Tool label="Undo" hint={`${key}Z`} disabled={off || !s?.canUndo} onClick={run((e) => e.chain().focus().undo().run())}>
          <Undo2 aria-hidden className="h-[18px] w-[18px]" />
        </Tool>
        <Tool label="Redo" hint={isMac() ? "⇧⌘Z" : "Ctrl+Y"} disabled={off || !s?.canRedo} onClick={run((e) => e.chain().focus().redo().run())}>
          <Redo2 aria-hidden className="h-[18px] w-[18px]" />
        </Tool>
      </span>
    </div>
  );
}

function Tool({
  label,
  hint,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Keep the selection in the document while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={hint ? `${label} (${hint})` : label}
      className="grid h-10 w-9 flex-none place-items-center rounded-lg sm:w-10 text-ink-2 transition-colors hover:bg-hover hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-ink aria-pressed:text-white"
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px flex-none bg-line sm:mx-1" />;
