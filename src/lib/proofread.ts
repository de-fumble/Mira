import "server-only";
import { z } from "zod";
import type { DocIssue } from "./documents";

const ReviewSchema = z.object({
  summary: z
    .string()
    .describe("2-3 plain sentences on how the document reads overall and what to fix first. Address the writer as 'you'."),
  issues: z.array(
    z.object({
      type: z.enum(["spelling", "grammar", "unclear", "off_topic"]),
      sentence: z.string().describe("The complete sentence containing the problem, copied exactly from the document"),
      quote: z
        .string()
        .describe("The exact words that are wrong, copied exactly from inside `sentence`. A single word for spelling; the whole sentence for unclear/off_topic"),
      suggestion: z
        .string()
        .nullable()
        .describe("Text to replace `quote` with. For unclear sentences, a clearer rewrite if the intended meaning is obvious. Null if there is no safe replacement"),
      explanation: z.string().describe("One short, friendly sentence saying what is wrong"),
    }),
  ),
});

const RESPONSE_SCHEMA = z.toJSONSchema(ReviewSchema);

const SYSTEM_PROMPT = `You proofread documents that people dictated by voice. The text came from speech recognition, then the writer may have edited it.

Find problems a careful human proofreader would fix, in four categories:
- spelling: misspelled words, and words the speech recognition misheard as a similar-sounding word (for example "their/there", "weight/wait", "except/accept", "brake/break") where the intended word is clear from context. Also wrong capitalisation of names, places, days and months.
- grammar: grammar, punctuation and agreement errors, missing or doubled words, and leftover spoken commands such as "comma", "full stop", "new paragraph" or "question mark" that were typed out as words.
- unclear: sentences that don't make sense, are garbled, or are so confusing a reader would stop. Give a clearer rewrite in suggestion when the intended meaning is obvious; otherwise null.
- off_topic: sentences that don't belong in this document — they clash with its subject or purpose, look like stray speech that was picked up by accident ("hold on, let me get the door"), or contradict the surrounding text.

Rules:
- Copy sentence and quote character-for-character from the document, including punctuation and capitalisation, so they can be found in the text. Never paraphrase them.
- Keep quote as short as possible: only the wrong words. For a misspelt word, quote just that word; for a grammar error, just the words that change.
- Respect the writer's variety of English (British, American, Nigerian and so on) and their tone. Don't flag style preferences, informal wording that is clearly intentional, or names you can't verify.
- Report each problem once. If a word is wrong the same way many times, report each occurrence.
- If there are more than 150 problems, report the 150 most important.
- If the document is clean, return an empty list. Never invent problems.`;

/**
 * Tried in order: when a model is overloaded, out of quota or retired, the
 * next one takes over. GEMINI_MODELS (comma-separated) overrides the list.
 */
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
const API = "https://generativelanguage.googleapis.com/v1beta/models";

/** The models a review tries, in order. */
export function modelChain(): string[] {
  const custom = (process.env.GEMINI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return custom.length ? custom : DEFAULT_MODELS;
}

/** Stay inside the route's 300-second limit. */
const TOTAL_BUDGET_MS = 270_000;
const FIRST_MODEL_MAX_MS = 180_000;
const MIN_ATTEMPT_MS = 20_000;

/** What happened with one model: answered, or why the next one was tried. */
export type AttemptResult = "ok" | "busy" | "quota" | "missing" | "timeout" | "network" | "bad_reply" | "error";
export type Attempt = { model: string; result: AttemptResult; ms: number };
export type ReviewMeta = {
  model: string;
  attempts: Attempt[];
  usage: { input: number | null; output: number | null; thinking: number | null };
};

/** A review that didn't finish. `attempts` says which models were tried. */
export class ReviewError extends Error {
  attempts: Attempt[] = [];
}
/** AI review can't run on this server (no key, or the key was rejected). */
export class ReviewUnavailableError extends ReviewError {}
/** Every model was busy or out of quota — worth trying again shortly. */
export class ReviewBusyError extends ReviewError {}

type GeminiResponse = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
};

/** The next model may succeed where this one didn't. */
class TryNextModel extends Error {
  constructor(
    readonly result: Exclude<AttemptResult, "ok" | "error">,
    detail: string,
  ) {
    super(detail);
  }
}

export type Review = { summary: string; issues: Omit<DocIssue, "id">[] };

export async function proofread(title: string, content: string): Promise<{ review: Review; meta: ReviewMeta }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ReviewUnavailableError("AI review isn’t set up yet: add GEMINI_API_KEY to the server settings.");

  const chain = modelChain();
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `<title>${title}</title>\n<document>\n${content}\n</document>\n\nProofread this document.` }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA, maxOutputTokens: 65536 },
  });

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const attempts: Attempt[] = [];
  let lastError: unknown;
  for (const [i, model] of chain.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;
    // Leave the backup models some time if the first one hangs.
    const timeout = i === 0 && chain.length > 1 ? Math.min(remaining, FIRST_MODEL_MAX_MS) : remaining;
    const started = Date.now();
    try {
      const { review, usage } = await callModel(model, key, body, timeout);
      attempts.push({ model, result: "ok", ms: Date.now() - started });
      return { review, meta: { model, attempts, usage } };
    } catch (err) {
      const ms = Date.now() - started;
      if (!(err instanceof TryNextModel)) {
        attempts.push({ model, result: "error", ms });
        const wrapped =
          err instanceof ReviewError ? err : new ReviewError(err instanceof Error ? err.message : "Review failed", { cause: err });
        wrapped.attempts = attempts;
        throw wrapped;
      }
      console.warn(`Proofread: ${model} unavailable — ${err.message}`);
      attempts.push({ model, result: err.result, ms });
      lastError = err;
    }
  }
  const busy = new ReviewBusyError("The AI reviewer is busy right now. Please try again in a minute.", { cause: lastError });
  busy.attempts = attempts;
  throw busy;
}

async function callModel(model: string, key: string, body: string, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new TryNextModel(timedOut ? "timeout" : "network", timedOut ? "timed out" : "network error");
  }

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const message = json.error?.message ?? "";
    if (res.status === 401 || res.status === 403 || /api key/i.test(message)) {
      throw new ReviewUnavailableError("AI review isn’t set up correctly: the Gemini API key was rejected.");
    }
    // Busy (503/500), out of quota (429) or retired/unknown model (404).
    if (res.status === 429) throw new TryNextModel("quota", "HTTP 429");
    if (res.status === 404) throw new TryNextModel("missing", "HTTP 404");
    if (res.status >= 500) throw new TryNextModel("busy", `HTTP ${res.status}`);
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${message}`);
  }

  if (json.promptFeedback?.blockReason) throw new Error("The review request was declined.");
  const candidate = json.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("The review came back incomplete. Please try again.");
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    // SAFETY, RECITATION and the like: another model may answer.
    throw new TryNextModel("bad_reply", `finish reason ${candidate.finishReason}`);
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TryNextModel("bad_reply", "reply wasn’t valid JSON");
  }
  const result = ReviewSchema.safeParse(parsed);
  if (!result.success) throw new TryNextModel("bad_reply", "reply didn’t match the review format");
  const u = json.usageMetadata;
  return {
    review: result.data,
    usage: { input: u?.promptTokenCount ?? null, output: u?.candidatesTokenCount ?? null, thinking: u?.thoughtsTokenCount ?? null },
  };
}
