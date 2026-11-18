// How a formatted document is stored: plain text with a few light markers,
// so older (unformatted) documents need no conversion and the text stays
// readable anywhere. Used by the editor, the exports and the review.
//
//   # Heading            ## Subheading
//   - Bullet item        1. Numbered item
//   **bold**  _italic_  ++underline++
//   A line ending in \ continues on the next line (a line break, not a new paragraph).
//   Paragraphs are separated by a blank line. \* \_ \+ \\ … are literal characters.
//
// Old plain-text documents read the same way: a single newline is a line
// break, a blank line starts a new paragraph.

export type Mark = "b" | "i" | "u";
/** Text with the same formatting. A "\n" in text is a line break. */
export type Run = { text: string; marks: Mark[] };
/** One paragraph, heading or list item ("ul"/"ol" = one bullet/numbered item). */
export type BlockType = "p" | "h1" | "h2" | "ul" | "ol";
export type Block = { type: BlockType; runs: Run[] };

const MARK_ORDER: Mark[] = ["b", "i", "u"];
const DELIMS: [Mark, string][] = [
  ["b", "**"],
  ["u", "++"],
  ["i", "_"],
];
const TOKEN: Record<Mark, string> = { b: "**", i: "_", u: "++" };
const ESCAPABLE = "\\*_+#-•.)";
const sortMarks = (m: Mark[]) => MARK_ORDER.filter((x) => m.includes(x));
const sameMarks = (a: Mark[], b: Mark[]) => a.length === b.length && a.every((m, i) => m === b[i]);

export const blockText = (b: Block) => b.runs.map((r) => r.text).join("");
const isList = (t: BlockType) => t === "ul" || t === "ol";
/** What goes between two blocks in the plain text: items of one list sit on consecutive lines. */
export const separator = (a: BlockType, b: BlockType) => (isList(a) && a === b ? "\n" : "\n\n");

/** The words only — what the review reads, word counts and the plain-text download. */
export function plainOf(blocks: Block[]): string {
  let out = "";
  blocks.forEach((b, i) => {
    if (i) out += separator(blocks[i - 1].type, b.type);
    out += blockText(b);
  });
  return out;
}

/** Stored text → plain words (old plain-text documents come back unchanged, apart from list markers). */
export const toPlain = (stored: string) => plainOf(parseDoc(stored));

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function findClose(s: string, tok: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "\n") return -1;
    if (s.startsWith(tok, j)) return j;
  }
  return -1;
}

function parseInline(s: string, marks: Mark[], out: Run[]) {
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, marks });
    buf = "";
  };
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    const d = DELIMS.find(([m, tok]) => !marks.includes(m) && s.startsWith(tok, i));
    if (d) {
      const [m, tok] = d;
      const start = i + tok.length;
      const close = findClose(s, tok, start);
      // Like Markdown: no space just inside the markers ("5 * 3", "C++ and C++" stay as they are).
      if (close > start && !/\s/.test(s[start]) && !/\s/.test(s[close - 1])) {
        flush();
        parseInline(s.slice(start, close), sortMarks([...marks, m]), out);
        i = close + tok.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out.at(-1);
    if (last && sameMarks(last.marks, r.marks)) last.text += r.text;
    else out.push({ text: r.text, marks: r.marks });
  }
  return out;
}

const trailingBackslashes = (line: string) => line.length - line.replace(/\\+$/, "").length;

/** Stored text → blocks. */
export function parseDoc(stored: string): Block[] {
  const blocks: Block[] = [];
  const chunks = stored.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const raw: { type: BlockType; text: string }[] = [];
    let continued = false;
    for (let line of chunk.split("\n")) {
      // A line ending in an unescaped backslash continues on the next one.
      const goesOn = trailingBackslashes(line) % 2 === 1;
      if (goesOn) line = line.slice(0, -1);
      const cur = raw.at(-1);
      let m: RegExpMatchArray | null;
      if (continued && cur) cur.text += "\n" + line;
      else if ((m = line.match(/^(#{1,2}) (.*)$/))) raw.push({ type: m[1].length === 1 ? "h1" : "h2", text: m[2] });
      else if ((m = line.match(/^[-•] (.*)$/))) raw.push({ type: "ul", text: m[1] });
      else if ((m = line.match(/^\d{1,3}[.)] (.*)$/))) raw.push({ type: "ol", text: m[1] });
      else if (cur?.type === "p") cur.text += "\n" + line; // plain-text documents: a newline is a line break
      else raw.push({ type: "p", text: line });
      continued = goesOn;
    }
    for (const r of raw) {
      const runs: Run[] = [];
      parseInline(r.text, [], runs);
      blocks.push({ type: r.type, runs: mergeRuns(runs) });
    }
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/** Formatting never starts or ends on a space or line break (so the markers read back). */
function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    r.text.split(/(\n)/).forEach((piece) => {
      if (!piece) return;
      if (piece === "\n" || !r.marks.length) return void out.push({ text: piece, marks: piece === "\n" ? [] : r.marks });
      const [, lead, core, trail] = piece.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      if (lead) out.push({ text: lead, marks: [] });
      if (core) out.push({ text: core, marks: sortMarks(r.marks) });
      if (trail) out.push({ text: trail, marks: [] });
    });
  }
  return mergeRuns(out);
}

const escapeText = (t: string) => t.replace(/[\\*_+]/g, "\\$&");

function serializeRuns(runs: Run[]): string {
  let out = "";
  const open: Mark[] = [];
  const close = () => (out += TOKEN[open.pop()!]);
  for (const r of tidyRuns(runs)) {
    // (Formatted runs never contain a line break — tidyRuns splits them out.)
    while (open.length && !open.every((m) => r.marks.includes(m))) close();
    for (const m of r.marks) {
      if (!open.includes(m)) {
        open.push(m);
        out += TOKEN[m];
      }
    }
    out += escapeText(r.text).replace(/\n/g, "\\\n");
  }
  while (open.length) close();
  return out;
}

const PREFIX: Record<BlockType, string> = { p: "", h1: "# ", h2: "## ", ul: "- ", ol: "" };

/** Blocks → stored text. Empty paragraphs at the very end are left off. */
export function serializeDoc(blocks: Block[]): string {
  const list = trimTrailingEmpty(blocks);
  let out = "";
  let n = 0;
  let marked = false;
  list.forEach((b, i) => {
    // (List items are grouped by type, not by spacing, so a blank line between two is harmless.)
    if (i) out += marked ? "\n\n" : separator(list[i - 1].type, b.type);
    n = b.type === "ol" && list[i - 1]?.type === "ol" ? n + 1 : 1;
    let line = serializeRuns(b.runs);
    // Paragraph text that would read back as a heading or list item.
    if (b.type === "p") line = line.replace(/^(#{1,2}) /, "\\$1 ").replace(/^([-•]) /, "\\$1 ").replace(/^(\d{1,3})([.)]) /, "$1\\$2 ");
    let full = (b.type === "ol" ? `${n}. ` : PREFIX[b.type]) + line;
    // A last line of only spaces (or an empty paragraph) would read as a blank line: end it with "\".
    marked = !full.slice(full.lastIndexOf("\n") + 1).trim();
    if (marked) full += "\\";
    out += full;
  });
  return out;
}

export function trimTrailingEmpty(blocks: Block[]): Block[] {
  let end = blocks.length;
  while (end > 0 && blocks[end - 1].type === "p" && !blockText(blocks[end - 1])) end--;
  return end === blocks.length ? blocks : blocks.slice(0, end);
}

/** True if the stored text has any formatting (bold, headings, lists…). */
export const hasFormatting = (blocks: Block[]) => blocks.some((b) => b.type !== "p" || b.runs.some((r) => r.marks.length));
