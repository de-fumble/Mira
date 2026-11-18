// The document editor's link between ProseMirror (what's on screen) and the
// stored text / plain words (lib/rich-text): converting both ways, mapping
// plain-text positions (review issues, dictation) onto the editor, and
// putting dictated text in.

import { Extension, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { separator, trimTrailingEmpty, type Block, type BlockType, type Mark, type Run } from "@/lib/rich-text";

const MARK_NAME: Record<Mark, string> = { b: "bold", i: "italic", u: "underline" };
const MARK_OF: Record<string, Mark> = { bold: "b", italic: "i", underline: "u" };

/** Blocks → the editor's content. */
export function blocksToContent(blocks: Block[]): JSONContent {
  const inline = (runs: Run[]): JSONContent[] =>
    runs.flatMap((r) =>
      r.text.split("\n").flatMap((t, i) => [
        ...(i ? [{ type: "hardBreak" }] : []),
        ...(t ? [{ type: "text", text: t, ...(r.marks.length ? { marks: r.marks.map((m) => ({ type: MARK_NAME[m] })) } : {}) }] : []),
      ]),
    );
  const content: JSONContent[] = [];
  for (const b of blocks) {
    const body = inline(b.runs);
    const para: JSONContent = { type: "paragraph", ...(body.length ? { content: body } : {}) };
    if (b.type === "p") content.push(para);
    else if (b.type === "h1" || b.type === "h2") content.push({ ...para, type: "heading", attrs: { level: b.type === "h1" ? 1 : 2 } });
    else {
      const listType = b.type === "ul" ? "bulletList" : "orderedList";
      const last = content.at(-1);
      const item = { type: "listItem", content: [para] };
      if (last?.type === listType) last.content!.push(item);
      else content.push({ type: listType, content: [item] });
    }
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * The editor's document as blocks (what gets saved) and as plain words (what
 * the review reads), with where each plain character sits in the editor.
 * `plain` is exactly what the server gets from the saved text.
 */
export type DocModel = {
  blocks: Block[];
  plain: string;
  /** Editor position of the cursor just before plain character k (k = 0…plain.length). */
  at: Int32Array;
  /** Whether plain character k is a character in the editor (not a gap between blocks). */
  isText: Uint8Array;
};

export function docModel(doc: PMNode): DocModel {
  type Item = { block: Block; start: number; end: number; pos: number[] };
  const items: Item[] = [];
  const visit = (node: PMNode, pos: number, listType: BlockType | null) => {
    if (node.isTextblock) {
      const type: BlockType = listType ?? (node.type.name === "heading" ? (node.attrs.level === 1 ? "h1" : "h2") : "p");
      const start = pos + 1;
      const runs: Run[] = [];
      const charPos: number[] = [];
      node.forEach((child, offset) => {
        if (child.isText) {
          const text = child.text ?? "";
          runs.push({ text, marks: child.marks.map((m) => MARK_OF[m.type.name]).filter(Boolean) });
          for (let k = 0; k < text.length; k++) charPos.push(start + offset + k);
        } else if (child.type.name === "hardBreak") {
          runs.push({ text: "\n", marks: [] });
          charPos.push(start + offset);
        }
      });
      items.push({ block: { type, runs }, start, end: start + node.content.size, pos: charPos });
      return;
    }
    const childList: BlockType | null =
      node.type.name === "bulletList" ? "ul" : node.type.name === "orderedList" ? "ol" : listType;
    node.forEach((child, offset) => visit(child, pos + 1 + offset, childList));
  };
  doc.forEach((child, offset) => visit(child, offset, null));

  const kept = trimTrailingEmpty(items.map((i) => i.block)).length;
  const list = items.slice(0, kept);
  let plain = "";
  const at: number[] = [];
  const isText: number[] = [];
  list.forEach((item, i) => {
    if (i) {
      const sep = separator(list[i - 1].block.type, item.block.type);
      for (let k = 0; k < sep.length; k++) {
        at.push(k === 0 ? list[i - 1].end : item.start);
        isText.push(0);
      }
      plain += sep;
    }
    for (const r of item.block.runs) plain += r.text;
    at.push(...item.pos);
    for (let k = 0; k < item.pos.length; k++) isText.push(1);
  });
  at.push(list.length ? list.at(-1)!.end : 1);
  return { blocks: list.map((i) => i.block), plain, at: Int32Array.from(at), isText: Uint8Array.from(isText) };
}

/** Plain-text offset → editor position. "end" = just after the character before it. */
export function toPos(m: DocModel, offset: number, side: "start" | "end" = "start"): number {
  const o = Math.max(0, Math.min(offset, m.plain.length));
  if (side === "end" && o > 0 && m.isText[o - 1]) return m.at[o - 1] + 1;
  return m.at[o];
}

/** Editor position → plain-text offset. */
export function toOffset(m: DocModel, pos: number): number {
  let lo = 0;
  let hi = m.at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m.at[mid] < pos) lo = mid + 1;
    else hi = mid;
  }
  // At the start of a block: the block's first character, not the gap before it.
  while (lo < m.plain.length && !m.isText[lo] && m.at[lo + 1] <= pos) lo++;
  return lo;
}

/**
 * Replaces from…to with plain text ("\n\n" = new paragraph or list item,
 * "\n" = line break). Returns where the new text ends.
 */
export function replaceWithText(tr: Transaction, from: number, to: number, text: string): number {
  const { schema } = tr.doc.type;
  if (to > from) tr.delete(from, to);
  let pos = from;
  text.split(/\n{2,}/).forEach((para, i) => {
    if (i) {
      const $p = tr.doc.resolve(pos);
      const inItem = $p.depth >= 2 && $p.node($p.depth - 1).type.name === "listItem";
      const after = $p.parent.type.name === "heading" ? [{ type: schema.nodes.paragraph }] : undefined;
      tr.split(pos, inItem ? 2 : 1, inItem ? undefined : after);
      pos += inItem ? 4 : 2;
    }
    para.split("\n").forEach((line, j) => {
      if (j) {
        tr.insert(pos, schema.nodes.hardBreak.create());
        pos += 1;
      }
      if (line) {
        tr.insertText(line, pos);
        pos += line.length;
      }
    });
  });
  return pos;
}

/* ------------------------------------------------------------------ */
/* Highlights (review issues, the words being dictated)                */
/* ------------------------------------------------------------------ */

const highlightsKey = new PluginKey<DecorationSet>("miraHighlights");

export type Highlight = { from: number; to: number; className: string; id: string };

export const Highlights = Extension.create({
  name: "miraHighlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightsKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(highlightsKey) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => highlightsKey.getState(state) },
      }),
    ];
  },
});

export function setHighlights(view: { state: { doc: PMNode; tr: Transaction }; dispatch: (tr: Transaction) => void }, list: Highlight[]) {
  const { doc } = view.state;
  const size = doc.content.size;
  const decos = list
    .filter((h) => h.to > h.from && h.from >= 0 && h.to <= size)
    .map((h) => Decoration.inline(h.from, h.to, { class: h.className, "data-issue": h.id }));
  view.dispatch(view.state.tr.setMeta(highlightsKey, DecorationSet.create(doc, decos)).setMeta("addToHistory", false));
}

/** Lists stay one level deep (that's what's saved and exported): Tab doesn't indent an item. */
export const FlatLists = Extension.create({
  name: "miraFlatLists",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.isActive("listItem"),
      "Shift-Tab": () => this.editor.isActive("listItem") && this.editor.commands.liftListItem("listItem"),
    };
  },
});
