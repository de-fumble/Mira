import "server-only";
import { z } from "zod";
import { countWords, findAll, ISSUE_TYPES, scoreFor, type DocBrief, type DocIssue, type IssueType } from "../documents";
import type { ReviewEvent, ReviewStage } from "./events";
import { fastModelChain, generateJson, modelChain, requireKey, ReviewError, ReviewUnavailableError, type Attempt, type Usage } from "./gemini";
import { ruleChecks, type RuleIssue } from "./rules";
import { chunk, segment, type Chunk, type Sentence } from "./segment";

/*
 * The correction engine. Every review runs the same stages, in order:
 *
 *   1. Read        (code)  Split the text into paragraphs and numbered sentences;
 *                          long documents into parts of ~1,200 words.
 *   2. Rules       (code)  Find the mistakes code can be certain about: doubled
 *                          words, spoken punctuation typed out, missing capitals,
 *                          stray spaces. Free, instant, never wrong.
 *   3. Understand  (AI)    One quick read of the whole document: what it is, who
 *                          it's for, its tone, its variety of English, and the
 *                          names and terms to leave alone.
 *   4. Check       (AI)    Each part, in parallel, sentence by sentence — judged
 *                          against that context, with the rule findings marked
 *                          as already done.
 *   5. Verify      (code)  Every AI flag must point at a real sentence and quote
 *                          words that are really there; vague, duplicate and
 *                          low-confidence flags are dropped.
 *   6. Score       (code)  The score and a plain summary, from what survived.
 *
 * The AI never edits the document: it only proposes flags, and the writer
 * decides.
 */

export const PIPELINE_VERSION = 2;

const TOTAL_BUDGET_MS = 270_000; // the analyze route may run for 300 s
const UNDERSTAND_MAX_MS = 60_000;
/** How long the main model gets before a backup takes over: longer for bigger parts. */
const checkPatienceMs = (words: number) => Math.min(150_000, 45_000 + words * 85);
const PART_WORDS = 1200;
const PARALLEL_PARTS = 4;
const MAX_ISSUES = 150;

export type ReviewMeta = {
  /** The model that checked most of the document. */
  model: string;
  attempts: Attempt[];
  usage: Usage;
  /** A backup model had to step in somewhere. */
  fellBack: boolean;
};

export type ReviewResult = {
  summary: string;
  issues: Omit<DocIssue, "id">[];
  brief: DocBrief | null;
  score: number;
  words: number;
  parts: number;
  stages: { stage: ReviewStage | "rules" | "score"; ms: number }[];
  meta: ReviewMeta;
};

/* ---------------------------------------------------------- Stage 3 */

const BriefSchema = z.object({
  kind: z.string().describe("What the document is, starting with 'a' or 'an': 'a letter to a customer', 'an internal quarterly report'"),
  purpose: z.string().describe("One short sentence: what the writer wants this document to achieve"),
  audience: z.string().describe("Who it is written for, in a few words"),
  tone: z.enum(["formal", "neutral", "casual"]),
  variety: z.string().describe("The variety of English used: British, American, Nigerian, Indian, Australian, Canadian or Other"),
  names: z
    .array(z.string())
    .describe("Names of people, places, organisations, products and specialist terms, spelled exactly as in the document (at most 60)"),
});

const UNDERSTAND_SYSTEM = `You read a document before it is proofread. It was dictated by voice, so it may contain speech-recognition mistakes — ignore them here.

Describe the document so a proofreader can judge every sentence in context: what it is, what it is for, who it is for, its tone and its variety of English, and the names and specialist terms it uses (copied exactly as written).

Do not list mistakes or rewrite anything.`;

/** The whole document, or for very long ones the beginning and the end. */
function excerpt(text: string): string {
  const words = text.split(/(\s+)/);
  if (words.length <= 24_000) return text; // ~12,000 words (separators count too)
  return `${words.slice(0, 16_000).join("")}\n\n[… middle of the document left out …]\n\n${words.slice(-4_000).join("")}`;
}

/* ---------------------------------------------------------- Stage 4 */

const CheckSchema = z.object({
  issues: z.array(
    z.object({
      sentence: z.string().describe("The ID of the sentence the problem is in, e.g. 'S12'"),
      type: z.enum(["spelling", "grammar", "unclear", "off_topic"]),
      quote: z
        .string()
        .describe("The exact wrong words, copied character for character from that sentence. Only the wrong words for spelling/grammar; the whole sentence for unclear/off_topic"),
      suggestion: z
        .string()
        .nullable()
        .describe("Replacement for the quote. For unclear sentences, a clear rewrite if the meaning is obvious. For off_topic, null. Null whenever there is no safe fix"),
      explanation: z.string().describe("One short, friendly sentence saying what is wrong"),
      confidence: z.enum(["high", "medium", "low"]).describe("How sure you are that this is a real mistake, given the document's context"),
    }),
  ),
});
type AiIssue = z.infer<typeof CheckSchema>["issues"][number];

const CHECK_SYSTEM = `You proofread part of a document that someone dictated by voice. The text came from speech recognition, then the writer may have edited it. You are given what the document is, who it is for and its tone — judge every sentence against that.

Report problems a careful human proofreader would fix, in four categories:
- spelling: misspelt words, and words the speech recognition misheard as a similar-sounding word ("their/there", "weight/wait", "except/accept", "sails/sales") where the intended word is clear from context. Wrong capitals on names, places, days and months.
- grammar: grammar, agreement and punctuation errors, missing or doubled words, and spoken commands typed out as words ("comma", "full stop", "new paragraph").
- unclear: a sentence that doesn't make sense, is garbled, or would make a reader stop. Suggest a clear rewrite only when the meaning is obvious.
- off_topic: a sentence that doesn't belong in this document — it clashes with its subject or purpose, is stray speech picked up by accident ("hold on, let me get the door", "can you hear me?"), or contradicts the surrounding text.

Rules:
- Only check sentences inside <sentences>. Sentences in <before> and <after> are there for context.
- Name the sentence by its ID and copy the quote exactly from it — same spelling, punctuation and capitals. Never paraphrase a quote.
- Keep quotes short: only the wrong words for spelling and grammar.
- Respect the writer's variety of English and tone. Don't flag style preferences, deliberate informal wording, or the names and terms listed in the context.
- Skip anything listed in <already_flagged>.
- One entry per problem. Use confidence "low" when you're guessing.
- If the part is clean, return an empty list. Never invent problems.`;

function briefBlock(title: string, brief: DocBrief | null, names: string[]): string {
  if (!brief) return `<document_context>\nTitle: ${title}\n(Context unavailable — judge from the text.)\n</document_context>`;
  return [
    "<document_context>",
    `Title: ${title}`,
    `What it is: ${brief.kind} — ${brief.purpose}`,
    `Written for: ${brief.audience}`,
    `Tone: ${brief.tone}`,
    `English: ${brief.variety} (respect its spelling and usage)`,
    names.length ? `Names and terms to keep as written: ${names.join(", ")}` : "",
    "</document_context>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Sentences as "[S12] text", with a blank line between paragraphs. */
function numbered(sentences: Sentence[]): string {
  return sentences.map((s, i) => (i && s.paragraph !== sentences[i - 1].paragraph ? "\n" : "") + `[${s.id}] ${s.text}`).join("\n");
}

function checkPrompt(title: string, brief: DocBrief | null, names: string[], part: Chunk, all: Sentence[], rules: RuleIssue[]): string {
  const first = all.indexOf(part.sentences[0]);
  const last = all.indexOf(part.sentences.at(-1)!);
  const before = all.slice(Math.max(0, first - 2), first);
  const after = all.slice(last + 1, last + 3);
  const ids = new Set(part.sentences.map((s) => s.id));
  const flagged = rules.filter((r) => ids.has(r.sentenceId));
  return [
    briefBlock(title, brief, names),
    flagged.length ? `<already_flagged>\n${flagged.map((r) => `${r.sentenceId}: “${r.quote}” → “${r.suggestion}”`).join("\n")}\n</already_flagged>` : "",
    before.length ? `<before>\n${numbered(before)}\n</before>` : "",
    `<sentences>\n${numbered(part.sentences)}\n</sentences>`,
    after.length ? `<after>\n${numbered(after)}\n</after>` : "",
    "Proofread every sentence inside <sentences>.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ---------------------------------------------------------- Stage 5 */

type Verified = Omit<DocIssue, "id"> & { start: number; end: number };

/**
 * Keeps only AI flags that hold up: a real sentence, words that are really in
 * it, a fix that changes something, not a protected name, not already flagged
 * by a rule, not a guess.
 */
function verify(ai: AiIssue[], part: Chunk, rules: RuleIssue[], names: Set<string>): Verified[] {
  const out: Verified[] = [];
  for (const issue of ai) {
    if (issue.confidence === "low") continue;
    const quote = issue.quote.trim();
    if (!quote) continue;
    const whole = issue.type === "unclear" || issue.type === "off_topic";
    // The sentence it names — or, if the ID is off, the one that contains the quote.
    let sentence = part.sentences.find((s) => s.id === issue.sentence.trim().toUpperCase());
    let at = sentence ? findAll(sentence.text, quote)[0] : undefined;
    if (!at) {
      for (const s of part.sentences) {
        const hit = findAll(s.text, quote)[0];
        if (hit) {
          sentence = s;
          at = hit;
          break;
        }
      }
    }
    if (!sentence) continue;
    if (!at) {
      // A paraphrased quote is only acceptable when the flag is about the whole sentence.
      if (!whole) continue;
      at = { start: 0, end: sentence.text.length };
    }
    const exact = sentence.text.slice(at.start, at.end);
    const suggestion = issue.suggestion?.trim() ?? null;
    if (suggestion !== null && suggestion === exact) continue; // changes nothing
    if (issue.type === "spelling" && names.has(exact) && (suggestion === null || suggestion.toLowerCase() !== exact.toLowerCase())) continue; // a name from the document
    const start = sentence.start + at.start;
    const end = sentence.start + at.end;
    if (rules.some((r) => start < r.end && r.start < end && !whole)) continue; // a rule already has it
    out.push({ type: issue.type, sentence: sentence.text, quote: exact, suggestion, explanation: issue.explanation.trim(), source: "ai", start, end });
  }
  return out;
}

/** One flag per spot (the more serious kind wins), most serious kept if there are too many. */
function finalise(issues: Verified[]): Verified[] {
  const weight = (i: Verified) => ISSUE_TYPES[i.type].weight;
  const kept: Verified[] = [];
  for (const i of [...issues].sort((a, b) => weight(b) - weight(a) || a.start - b.start)) {
    const clashes = kept.filter((k) => i.start < k.end && k.start < i.end);
    // A word-level fix inside a sentence flagged as a whole can stay — but
    // not two fixes on the same words.
    const fits = clashes.every((k) => (k.type === "unclear" || k.type === "off_topic") && i.end - i.start < k.end - k.start);
    if (fits) kept.push(i);
  }
  return kept
    .sort((a, b) => weight(b) - weight(a) || a.start - b.start)
    .slice(0, MAX_ISSUES)
    .sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------------- Stage 6 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Plain summary from what was found — no AI, so it always matches the flags. */
function summarize(brief: DocBrief | null, issues: Pick<DocIssue, "type">[]): string {
  const n = (t: IssueType) => issues.filter((i) => i.type === t).length;
  const [sp, gr, un, ot] = [n("spelling"), n("grammar"), n("unclear"), n("off_topic")];
  const found = [
    sp && plural(sp, "spelling slip", "spelling slips"),
    gr && plural(gr, "grammar or punctuation fix", "grammar or punctuation fixes"),
    un && plural(un, "sentence that doesn’t make sense", "sentences that don’t make sense"),
    ot && plural(ot, "sentence that doesn’t belong", "sentences that don’t belong"),
  ].filter(Boolean) as string[];
  const kind = brief?.kind.trim().replace(/\.$/, "");
  const intro = kind && /^(a|an|the)\s/i.test(kind) ? `This reads as ${kind.charAt(0).toLowerCase()}${kind.slice(1)}. ` : "";
  if (!found.length) return `${intro}It reads cleanly — Mira found nothing to fix.`;
  const list = found.length === 1 ? found[0] : `${found.slice(0, -1).join(", ")} and ${found.at(-1)}`;
  const next = ot
    ? `Start with the ${ot === 1 ? "sentence that doesn’t belong" : "sentences that don’t belong"}.`
    : un
      ? `Start with the ${un === 1 ? "unclear sentence" : "unclear sentences"} — they matter most to a reader.`
      : "These are quick fixes.";
  return `${intro}Mira found ${list}. ${next}`;
}

/* ---------------------------------------------------------- The run */

/** Runs `fn` over `items`, at most `limit` at a time; fails fast. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  input: (a.input ?? 0) + (b.input ?? 0),
  output: (a.output ?? 0) + (b.output ?? 0),
  thinking: (a.thinking ?? 0) + (b.thinking ?? 0),
});

export async function runReview(opts: {
  title: string;
  content: string;
  onProgress?: (e: ReviewEvent) => void;
}): Promise<ReviewResult> {
  requireKey(); // fail fast, before any work
  const { title, content } = opts;
  const progress = (e: Extract<ReviewEvent, { type: "stage" }>) => opts.onProgress?.(e);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const stages: ReviewResult["stages"] = [];
  const attempts: Attempt[] = [];
  let usage: Usage = { input: 0, output: 0, thinking: 0 };
  const timed = async <T>(stage: ReviewResult["stages"][number]["stage"], fn: () => Promise<T> | T): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      stages.push({ stage, ms: Date.now() - t });
    }
  };

  try {
    // 1 + 2. Read and rule checks.
    progress({ type: "stage", stage: "read" });
    const sentences = await timed("read", () => segment(content));
    const parts = chunk(sentences, PART_WORDS);
    const rules = await timed("rules", () => ruleChecks(sentences));

    // 3. Understand. If it fails, the review carries on without context.
    progress({ type: "stage", stage: "understand" });
    const { brief, names } = await timed("understand", async (): Promise<{ brief: DocBrief | null; names: string[] }> => {
      try {
        const r = await generateJson({
          stage: "understand",
          schema: BriefSchema,
          system: UNDERSTAND_SYSTEM,
          prompt: `<title>${title}</title>\n<document>\n${excerpt(content)}\n</document>`,
          chain: fastModelChain(),
          deadline: Math.min(deadline, Date.now() + UNDERSTAND_MAX_MS),
          maxOutputTokens: 4096,
        });
        attempts.push(...r.attempts);
        usage = addUsage(usage, r.usage);
        const { names: listed, kind, purpose, audience, tone, variety } = r.data;
        // Only names that really appear in the document can protect anything.
        const found = [...new Set(listed.map((x) => x.trim()).filter((x) => x.length > 1 && content.includes(x)))].slice(0, 60);
        return { brief: { kind, purpose, audience, tone, variety }, names: found };
      } catch (err) {
        if (err instanceof ReviewUnavailableError) throw err;
        if (err instanceof ReviewError) attempts.push(...err.attempts);
        console.warn("Review: couldn’t read the document’s context, carrying on without it", err);
        return { brief: null, names: [] };
      }
    });
    if (brief) progress({ type: "stage", stage: "understand", detail: brief.kind });

    // 4. Check each part (in parallel), 5. verify each answer as it arrives.
    let done = 0;
    progress({ type: "stage", stage: "check", done, total: parts.length });
    const protectedNames = new Set(names);
    const checkedBy: string[] = [];
    let verifyMs = 0;
    const checked = await timed("check", () =>
      pool(parts, PARALLEL_PARTS, async (part) => {
        const r = await generateJson({
          stage: "check",
          schema: CheckSchema,
          system: CHECK_SYSTEM,
          prompt: checkPrompt(title, brief, names, part, sentences, rules),
          chain: modelChain(),
          deadline,
          firstModelMaxMs: checkPatienceMs(part.words),
        }).catch((err: unknown) => {
          if (err instanceof ReviewError) attempts.push(...err.attempts);
          throw err;
        });
        attempts.push(...r.attempts);
        usage = addUsage(usage, r.usage);
        checkedBy.push(r.model);
        const t = Date.now();
        const verified = verify(r.data.issues, part, rules, protectedNames);
        verifyMs += Date.now() - t;
        progress({ type: "stage", stage: "check", done: ++done, total: parts.length });
        return verified;
      }),
    );

    // 5 (finish). Merge the rule findings with the verified AI flags.
    progress({ type: "stage", stage: "verify" });
    const merged = await timed("verify", () =>
      finalise([
        ...rules.map((r) => ({
          type: r.type,
          sentence: sentences.find((s) => s.id === r.sentenceId)!.text,
          quote: r.quote,
          suggestion: r.suggestion,
          explanation: r.explanation,
          source: "rule" as const,
          start: r.start,
          end: r.end,
        })),
        ...checked.flat(),
      ]),
    );
    stages.find((s) => s.stage === "verify")!.ms += verifyMs;

    // 6. Score and summary.
    const words = countWords(content);
    const issues: Omit<DocIssue, "id">[] = merged.map((i) => ({
      type: i.type,
      sentence: i.sentence,
      quote: i.quote,
      suggestion: i.suggestion,
      explanation: i.explanation,
      source: i.source,
    }));
    const result = await timed("score", () => ({ score: scoreFor(issues, words), summary: summarize(brief, issues) }));
    const counts = new Map<string, number>();
    for (const m of checkedBy) counts.set(m, (counts.get(m) ?? 0) + 1);
    return {
      ...result,
      issues,
      brief,
      words,
      parts: parts.length,
      stages,
      meta: {
        model: [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? modelChain()[0],
        attempts,
        usage,
        fellBack: attempts.some((a) => a.result !== "ok"),
      },
    };
  } catch (err) {
    // Hand the full attempt history to whoever logs the failure.
    if (err instanceof ReviewError) err.attempts = attempts.length ? attempts : err.attempts;
    throw err;
  }
}
