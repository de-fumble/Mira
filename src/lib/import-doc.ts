// Opening someone's own file as a Mira document (in the browser, before
// anything is sent): Word (.docx) and plain text. Headings, bold, italic,
// underline and lists come across; images and page layout don't.

import { DOC_MAX_CHARS, DOC_TITLE_MAX } from "./documents";
import { blockText, serializeDoc, type Block, type BlockType, type Mark, type Run } from "./rich-text";

export const IMPORT_ACCEPT = ".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class ImportError extends Error {}

export type Imported = {
  title: string;
  /** Stored text (lib/rich-text). */
  content: string;
  /** Things that were in the file but aren't in Mira documents. */
  left: { images: number; tables: number };
};

/** Reads a file the person picked. Throws ImportError with a message to show them. */
export async function readDocumentFile(file: File): Promise<Imported> {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (file.size > MAX_FILE_BYTES) throw new ImportError("That file is over 20 MB. Upload a smaller document.");
  if (ext === "doc") throw new ImportError("This is an older Word file (.doc). Open it in Word, choose File → Save As → Word Document (.docx), then upload that.");
  if (ext === "pdf") throw new ImportError("PDFs can’t be edited here yet. Open it in Word or Google Docs, save it as a Word document (.docx), then upload that.");
  if (ext !== "docx" && ext !== "txt") throw new ImportError("Mira can open Word documents (.docx) and text files (.txt).");

  let blocks: Block[];
  let left = { images: 0, tables: 0 };
  if (ext === "txt") {
    blocks = textToBlocks(await file.text());
  } else {
    let html: string;
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml(
        { arrayBuffer: await file.arrayBuffer() },
        { styleMap: ["u => u", "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
      );
      html = result.value;
    } catch {
      throw new ImportError("Mira couldn’t read this Word file. If it has a password, remove it in Word and try again.");
    }
    const root = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
    left = { images: root.querySelectorAll("img").length, tables: root.querySelectorAll("table").length };
    blocks = htmlToBlocks(root);
  }

  if (!blocks.some((b) => blockText(b).trim())) throw new ImportError("There’s no text in this file for Mira to edit.");
  const content = serializeDoc(blocks);
  if (content.length > DOC_MAX_CHARS) throw new ImportError("This document is too long for Mira (about 50,000 words at most). Split it into smaller files.");
  return { title: titleFrom(file.name), content, left };
}

/** "Q3 report_final.docx" → "Q3 report final". */
export function titleFrom(fileName: string): string {
  const t = fileName.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  // "report" → "Report" (names that already have capitals stay as they are).
  const nice = t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  return (nice || "Imported document").slice(0, DOC_TITLE_MAX);
}

/** Plain text: a blank line starts a new paragraph, a single line break stays a line break. */
export function textToBlocks(text: string): Block[] {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((para) => para.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, ""))
    .filter((para) => para.trim())
    .map((para) => ({ type: "p" as const, runs: [{ text: para, marks: [] }] }));
}

/* ------------------------------------------------------------------ */
/* Word → blocks (via the HTML mammoth makes)                           */
/* ------------------------------------------------------------------ */

const MARK_OF: Record<string, Mark> = { STRONG: "b", B: "b", EM: "i", I: "i", U: "u" };
const ORDER: Mark[] = ["b", "i", "u"];
const isEl = (n: Node): n is Element => n.nodeType === 1;
const isList = (n: Node) => isEl(n) && (n.tagName === "UL" || n.tagName === "OL");

/** Text with its formatting, from inside one paragraph, heading or list item. */
function inline(node: Node, marks: Mark[], out: Run[]) {
  for (const child of node.childNodes) inlineNode(child, marks, out);
}

function inlineNode(node: Node, marks: Mark[], out: Run[]) {
  if (node.nodeType === 3) return void out.push({ text: node.textContent ?? "", marks });
  if (!isEl(node)) return;
  const tag = node.tagName;
  if (tag === "BR") out.push({ text: "\n", marks: [] });
  else if (tag === "IMG" || isList(node)) return; // (lists inside a list item are their own items)
  else if (tag === "A" && node.textContent?.trim() === "↑") return; // footnote "back" links
  else {
    // A paragraph inside a list item or table cell: on its own line.
    if ((tag === "P" || tag === "DIV") && out.length) out.push({ text: "\n", marks: [] });
    const m = MARK_OF[tag];
    inline(node, m && !marks.includes(m) ? [...marks, m] : marks, out);
  }
}

/** Tidies spacing the way it shows on a page: single spaces, no spaces around line breaks, nothing at the ends. */
function tidy(runs: Run[]): Run[] {
  const chars: { ch: string; marks: Mark[] }[] = [];
  for (const r of runs) {
    for (let ch of r.text) {
      if (ch !== "\n" && /\s/.test(ch)) ch = " ";
      const prev = chars.at(-1)?.ch;
      if (ch === " " && (prev === undefined || prev === " " || prev === "\n")) continue;
      if (ch === "\n") {
        if (prev === undefined || prev === "\n") continue;
        if (prev === " ") chars.pop();
      }
      chars.push({ ch, marks: ch === "\n" ? [] : ORDER.filter((m) => r.marks.includes(m)) });
    }
  }
  while (chars.length && /\s/.test(chars.at(-1)!.ch)) chars.pop();
  const out: Run[] = [];
  for (const { ch, marks } of chars) {
    const last = out.at(-1);
    if (last && last.marks.join() === marks.join()) last.text += ch;
    else out.push({ text: ch, marks });
  }
  return out;
}

export function htmlToBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const push = (type: BlockType, runs: Run[]) => {
    const clean = tidy(runs);
    if (clean.length) blocks.push({ type, runs: clean });
  };
  const of = (el: Node, marks: Mark[] = []) => {
    const runs: Run[] = [];
    inline(el, marks, runs);
    return runs;
  };
  const list = (el: Element) => {
    const type = el.tagName === "OL" ? "ol" : "ul";
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      push(type, of(li));
      // Mira lists are one level deep: sub-items follow as items of their own.
      for (const sub of li.querySelectorAll(":scope > ul, :scope > ol")) list(sub);
    }
  };
  const walk = (node: Element) => {
    let loose: Run[] = []; // text sitting directly in a container
    const flush = () => {
      push("p", loose);
      loose = [];
    };
    for (const child of node.childNodes) {
      if (!isEl(child)) {
        if (child.nodeType === 3) loose.push({ text: child.textContent ?? "", marks: [] });
        continue;
      }
      const tag = child.tagName;
      if (/^(H[1-6]|P|UL|OL|TABLE|DIV|BLOCKQUOTE|SECTION|ARTICLE|PRE|HR)$/.test(tag)) flush();
      if (tag === "H1") push("h1", of(child));
      else if (tag === "H2") push("h2", of(child));
      else if (/^H[3-6]$/.test(tag)) push("p", of(child, ["b"])); // smaller headings: a bold line
      else if (tag === "P" || tag === "PRE") push("p", of(child));
      else if (tag === "UL" || tag === "OL") list(child);
      else if (tag === "TABLE") {
        // Each row on its own line, cells separated by " | ".
        for (const tr of child.querySelectorAll("tr")) {
          const runs: Run[] = [];
          [...tr.children].forEach((cell, i) => {
            if (i) runs.push({ text: " | ", marks: [] });
            inline(cell, [], runs);
          });
          push("p", runs.map((r) => (r.text === "\n" ? { ...r, text: " " } : r)));
        }
      } else if (tag === "HR" || tag === "IMG" || tag === "BR") continue;
      else if (/^(DIV|BLOCKQUOTE|SECTION|ARTICLE|BODY|MAIN)$/.test(tag)) walk(child);
      else inlineNode(child, [], loose); // bold, links… sitting loose
    }
    flush();
  };
  walk(root);
  return blocks;
}
