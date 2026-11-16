// Shared by the documents pages, the editor (browser) and the API routes.

export const DOC_TITLE_MAX = 120;
export const DOC_MAX_CHARS = 300_000; // ~50,000 words
export const REVIEW_MAX_WORDS = 25_000;

export type IssueType = "spelling" | "grammar" | "unclear" | "off_topic";

export type DocIssue = {
  id: string;
  type: IssueType;
  /** The whole sentence the problem is in, copied from the document. */
  sentence: string;
  /** The exact words that are wrong (inside `sentence`). */
  quote: string;
  /** Replacement for `quote`, or null when there is no simple fix. */
  suggestion: string | null;
  explanation: string;
};

export type DocAnalysis = {
  score: number; // 0–100 at the time of the review
  summary: string;
  issues: DocIssue[];
  dismissed: string[]; // issue ids the writer marked "keep as is"
  word_count: number;
  content_hash: string;
  analyzed_at: string;
};

export type DocumentRow = {
  id: string;
  title: string;
  content: string;
  word_count: number;
  analysis: DocAnalysis | null;
  created_at: string;
  updated_at: string;
};

export const ISSUE_TYPES: Record<IssueType, { label: string; plural: string; weight: number }> = {
  spelling: { label: "Spelling", plural: "Spelling", weight: 1 },
  grammar: { label: "Grammar", plural: "Grammar & punctuation", weight: 1.5 },
  unclear: { label: "Doesn’t make sense", plural: "Unclear sentences", weight: 3 },
  off_topic: { label: "Off topic", plural: "Off-topic sentences", weight: 4 },
};

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}](?:[\p{L}\p{N}'’-]|[.,](?=\p{N}))*/gu)?.length ?? 0;
}

/**
 * 100 = nothing to fix. Based on weighted problems per 100 words, on a
 * gentle curve: a clean 3,000-word document with ten typos scores ~97;
 * one with a problem in every few sentences scores in the 60s.
 */
export function scoreFor(issues: Pick<DocIssue, "type">[], words: number): number {
  if (words === 0) return 0;
  const weighted = issues.reduce((sum, i) => sum + ISSUE_TYPES[i.type].weight, 0);
  const per100 = (weighted / Math.max(words, 100)) * 100;
  return Math.round(100 * Math.exp(-0.08 * per100));
}

export function scoreLabel(score: number): { label: string; tone: "good" | "ok" | "warn" | "bad" } {
  if (score >= 90) return { label: "Excellent", tone: "good" };
  if (score >= 75) return { label: "Good — a few fixes", tone: "ok" };
  if (score >= 55) return { label: "Needs work", tone: "warn" };
  return { label: "Needs a careful edit", tone: "bad" };
}

/** Small, fast hash to tell whether the text changed since the last review. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}-${(h >>> 0).toString(36)}`;
}

export function cleanDocTitle(raw: string): { title: string; error?: string } {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return { title, error: "The title can’t be empty." };
  if (title.length > DOC_TITLE_MAX) return { title, error: `Keep the title under ${DOC_TITLE_MAX} characters.` };
  return { title };
}

/* ------------------------------------------------------------------ */
/* Dictation clean-up                                                  */
/* ------------------------------------------------------------------ */

const PROPER = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "april", "june", "july", "september", "october", "november", "december",
];
const PROPER_RE = new RegExp(`\\b(${PROPER.join("|")})\\b`, "gi");
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// Spoken commands → what they type. Longest first so "question mark" wins over shorter matches.
const COMMANDS: [string, string][] = [
  ["new paragraph", "\n\n"],
  ["next paragraph", "\n\n"],
  ["new line", "\n"],
  ["next line", "\n"],
  ["question mark", "?"],
  ["exclamation mark", "!"],
  ["exclamation point", "!"],
  ["full stop", "."],
  ["period", "."],
  ["comma", ","],
  ["semicolon", ";"],
  ["semi colon", ";"],
  ["colon", ":"],
  ["open quote", "“"],
  ["open quotes", "“"],
  ["close quote", "”"],
  ["close quotes", "”"],
  ["end quote", "”"],
  ["unquote", "”"],
  ["open bracket", "("],
  ["close bracket", ")"],
];
const CMD_WORDS = COMMANDS.map(([w]) => w.replace(" ", "\\s+")).sort((a, b) => b.length - a.length).join("|");
const P = "[,.;:!?]";
// A spoken command is said at a pause, so the speech service puts punctuation
// next to it ("Lagos, period." / "budget, question mark."). Words with no
// punctuation around them ("the trial period ends", "colon surgery") are left alone.
const CMD_RE = new RegExp(
  `[ \\t]*${P}*[ \\t]*(?:(?<=^|${P}[ \\t]*)\\b(${CMD_WORDS})\\b|\\b(${CMD_WORDS})\\b(?=[ \\t]*(?:${P}|$)))[ \\t]*${P}*`,
  "gi",
);
const lookup = (w: string) => COMMANDS.find(([c]) => c === w.toLowerCase().replace(/\s+/g, " "))?.[1] ?? "";

/**
 * Turns what the speech service returns into document text: spoken
 * punctuation and paragraphs, spacing, naira amounts, dates and capitals.
 */
export function cleanDictation(raw: string): string {
  let t = raw
    .replace(CMD_RE, (_m, a?: string, b?: string) => `\u0001${lookup(a ?? b ?? "")}\u0001`)
    .replace(/\u0001([^\u0001]*)\u0001/g, "$1")
    // Spacing around punctuation.
    .replace(/[ \t]+([.,;:!?”)])/g, "$1")
    .replace(/([.!?;:,])\s*([.!?])/g, (_m, a: string, b: string) => (a === "." || a === "," || a === ";" || a === ":" ? b : a))
    .replace(/([,;:])\s*,/g, "$1")
    .replace(/([,;:”)])(?=[\p{L}“(])/gu, "$1 ") // not before digits: "2,500", "10:30"
    .replace(/(?<=\p{Ll}{2}|\d|[”)])([.!?])(?=[\p{Lu}“(])/gu, "$1 ")
    .replace(/([\p{L}\p{N},.;:!?])([“(])/gu, "$1 $2")
    .replace(/([“(])\s+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Titles said in full before a name: "missus Adebayo" → "Mrs Adebayo".
    .replace(/\b[Mm]issus (?=\p{Lu})/gu, "Mrs ")
    .replace(/\b[Mm]ister (?=\p{Lu})/gu, "Mr ")
    // "N2.4 million" → "₦2.4 million" (not "N95").
    .replace(/\bN(?=\d[\d,.]*(?:\s?(?:million|billion|thousand|bn|m|k)\b|,\d{3}))/g, "₦")
    // "the March 3" (said "the third of March") → "3 March".
    .replace(/\bthe (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b/g, "$2 $1")
    .replace(PROPER_RE, (w) => cap(w.toLowerCase()))
    .replace(/\bi\b(?!\.)/g, "I"); // lone "i" (and i'm, i've…), but not "i.e."
  // Capital letter at the start of each sentence and paragraph (the very
  // start is left to joinDictated, which knows what comes before).
  t = t.replace(/((?<!\b(?:i\.e|e\.g|vs))[.!?]["”’)]?\s+|\n\s*)(“?)(\p{Ll})/gu, (_m, pre: string, q: string, ch: string) => pre + q + ch.toUpperCase());
  return t;
}

const LOWERCASE_STARTS = new Set(
  "a an and as at but by for from had has have he her his if in into is it its of on or our she so than that the their then there they this to was we were what when which who will with would you your".split(" "),
);

/**
 * Joins newly dictated text onto what comes before it: adds a space, and
 * starts a sentence with a capital only where a sentence actually starts.
 */
export function joinDictated(before: string, insert: string): string {
  let text = insert.replace(/^[ \t]+/, "");
  if (!text) return "";
  const trimmed = before.replace(/[ \t]+$/, "");
  const atStart = trimmed === "" || /[\n]$/.test(trimmed) || /[.!?]["”’)]?$/.test(trimmed);
  if (/^\n/.test(text)) return text; // starts a new line/paragraph
  if (atStart) {
    text = text.replace(/^(“?)(\p{Ll})/u, (_m, q: string, ch: string) => q + ch.toUpperCase());
  } else {
    // The speech service capitalises the start of each chunk; undo that mid-sentence.
    const first = text.match(/^(\p{Lu}\p{Ll}*)\b/u)?.[1];
    if (first && LOWERCASE_STARTS.has(first.toLowerCase())) text = first.toLowerCase() + text.slice(first.length);
  }
  const needsSpace = before !== "" && !/[\s“(]$/.test(before) && !/^[.,;:!?”)]/.test(text);
  return (needsSpace ? " " : "") + text;
}

/* ------------------------------------------------------------------ */
/* Finding flagged text in the document                                */
/* ------------------------------------------------------------------ */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pattern that tolerates curly/straight quotes, dash styles and spacing. */
function looseRegex(s: string) {
  const body = escapeRe(s.trim())
    .replace(/['’‘]/g, "['’‘]")
    .replace(/["“”]/g, "[\"“”]")
    .replace(/[-–—]/g, "[-–—]")
    .replace(/\s+/g, "\\s+");
  return new RegExp(body, "g");
}

function findAll(text: string, needle: string): { start: number; end: number }[] {
  if (!needle.trim()) return [];
  const out: { start: number; end: number }[] = [];
  const re = looseRegex(needle);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export type LocatedIssue = DocIssue & { start: number; end: number };

/**
 * Where each issue currently is in the text. Issues whose words are no
 * longer there (fixed or rewritten) are left out.
 */
export function locateIssues(text: string, issues: DocIssue[]): LocatedIssue[] {
  const used: { start: number; end: number }[] = [];
  const overlaps = (a: { start: number; end: number }) => used.some((b) => a.start < b.end && b.start < a.end);
  const out: LocatedIssue[] = [];
  for (const issue of issues) {
    let hit: { start: number; end: number } | undefined;
    for (const s of findAll(text, issue.sentence)) {
      const inner = findAll(text.slice(s.start, s.end), issue.quote).map((q) => ({ start: s.start + q.start, end: s.start + q.end }));
      hit = inner.find((q) => !overlaps(q));
      if (hit) break;
    }
    // Sentence was edited but the problem words are still there.
    if (!hit) hit = findAll(text, issue.quote).find((q) => !overlaps(q) && (issue.quote.length > 3 || issue.type === "spelling"));
    if (!hit) continue;
    used.push(hit);
    out.push({ ...issue, ...hit });
  }
  return out.sort((a, b) => a.start - b.start);
}
