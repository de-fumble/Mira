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
  /** Found by a rule (certain) or by the AI (judgement). Older reviews: unset. */
  source?: "rule" | "ai";
};

/** What the review understood the document to be — the context every flag is judged against. */
export type DocBrief = {
  /** "a letter to a customer", "a quarterly report" */
  kind: string;
  purpose: string;
  audience: string;
  tone: "formal" | "neutral" | "casual";
  /** "British", "American", "Nigerian"… */
  variety: string;
};

export type DocAnalysis = {
  score: number; // 0–100 at the time of the review
  summary: string;
  issues: DocIssue[];
  dismissed: string[]; // issue ids the writer marked "keep as is"
  word_count: number;
  content_hash: string;
  analyzed_at: string;
  /** Pipeline reviews only (older reviews don't have these). */
  brief?: DocBrief | null;
  pipeline?: { version: number; parts: number; stages: { stage: string; ms: number }[] };
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

/** Every place `needle` appears in `text`, tolerating quote/dash/spacing differences. */
export function findAll(text: string, needle: string): { start: number; end: number }[] {
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

/**
 * The score as it stands now: the last review's flags that are still in the
 * text (not fixed, not marked "keep as is"), scored against the current words.
 * The editor's score card and the documents list both show this.
 */
/**
 * The flags "Apply all" fixes: every one with a suggested fix, never two on
 * the same words (a sentence rewrite wins over a word fix inside it — the
 * rewrite already covers it). In reading order.
 */
export function bulkFixes(issues: LocatedIssue[]): LocatedIssue[] {
  const kept: LocatedIssue[] = [];
  const byLength = issues.filter((i) => i.suggestion !== null).sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  for (const i of byLength) if (!kept.some((k) => i.start < k.end && k.start < i.end)) kept.push(i);
  return kept.sort((a, b) => a.start - b.start);
}

export function currentScore(analysis: DocAnalysis, plain: string): number {
  const open = analysis.issues.filter((i) => !(analysis.dismissed ?? []).includes(i.id));
  return scoreFor(locateIssues(plain, open), countWords(plain));
}

/* ------------------------------------------------------------------ */
/* Dictating vs typing                                                 */
/* ------------------------------------------------------------------ */

/** An average typing speed (words a minute) — what dictation time is compared with. */
export const TYPING_WPM = 40;

/** How long typing `words` would take, in seconds. */
export const typingSeconds = (words: number) => Math.round((words / TYPING_WPM) * 60);

/** "45 sec", "2 min 10 sec", "14 min", "1 h 5 min". */
export function formatSpan(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} sec`;
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} sec` : `${s / 60} min`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
