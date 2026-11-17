// Stage 1 of the review pipeline: split a document into paragraphs and
// numbered sentences (with their exact place in the text), and long
// documents into parts the AI can check one at a time. Pure — no I/O.

import { countWords } from "../documents";

export type Sentence = {
  /** "S1", "S2", … in reading order. */
  id: string;
  text: string;
  /** Character offsets in the original document. */
  start: number;
  end: number;
  paragraph: number;
};

export type Chunk = { index: number; sentences: Sentence[]; words: number };

// Words that end with a full stop without ending the sentence.
const ABBREVIATIONS = new Set(
  "mr mrs ms dr prof sr jr st no nos vs etc e.g i.e eg ie approx dept est fig inc ltd co corp jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun am pm a.m p.m u.s u.k ph.d".split(" "),
);

/** Paragraphs: blocks separated by line breaks. Offsets point into `text`. */
function paragraphs(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[^\r\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lead = m[0].length - m[0].trimStart().length;
    const body = m[0].trim();
    if (body) out.push({ start: m.index + lead, end: m.index + lead + body.length });
  }
  return out;
}

/** Sentences inside one paragraph, as [start, end) offsets relative to it. */
function splitSentences(p: string): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  // A sentence ends at . ! ? (possibly repeated, possibly followed by a closing
  // quote or bracket) when whitespace follows.
  const re = /[.!?]+["”’)\]]*(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    const end = m.index + m[0].length;
    // "Wait... what": an ellipsis is a pause, not the end of a sentence.
    if (/^\.{2,}/.test(m[0])) continue;
    if (m[0].startsWith(".") && m[0].length === 1) {
      const word = p.slice(from, m.index).match(/(\S+)$/)?.[1]?.toLowerCase().replace(/^[“"(]/, "") ?? "";
      // "Mr. Smith", "e.g. this", "J. Smith", "No. 4": not a sentence end.
      if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) continue;
    }
    out.push([from, end]);
    from = end + (p.slice(end).match(/^\s+/)?.[0].length ?? 0);
  }
  if (from < p.length) out.push([from, p.length]);
  return out.filter(([s, e]) => p.slice(s, e).trim());
}

export function segment(text: string): Sentence[] {
  const out: Sentence[] = [];
  paragraphs(text).forEach((para, pi) => {
    const body = text.slice(para.start, para.end);
    for (const [s, e] of splitSentences(body)) {
      out.push({ id: `S${out.length + 1}`, text: body.slice(s, e), start: para.start + s, end: para.start + e, paragraph: pi });
    }
  });
  return out;
}

/**
 * Groups sentences into parts of about `maxWords`, breaking between
 * paragraphs where possible (a paragraph longer than that is split by sentence).
 */
export function chunk(sentences: Sentence[], maxWords = 1200): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Sentence[] = [];
  let words = 0;
  const flush = () => {
    if (current.length) chunks.push({ index: chunks.length, sentences: current, words });
    current = [];
    words = 0;
  };
  const byParagraph = new Map<number, Sentence[]>();
  for (const s of sentences) byParagraph.set(s.paragraph, [...(byParagraph.get(s.paragraph) ?? []), s]);
  for (const para of byParagraph.values()) {
    const paraWords = para.reduce((n, s) => n + countWords(s.text), 0);
    if (words && words + paraWords > maxWords) flush();
    for (const s of para) {
      const w = countWords(s.text);
      if (words && words + w > maxWords) flush();
      current.push(s);
      words += w;
    }
  }
  flush();
  return chunks;
}
