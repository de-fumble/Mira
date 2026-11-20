import "server-only";
import { z } from "zod";

/*
 * Talks to Google's Gemini API for the review pipeline. Every call asks for
 * JSON in a fixed shape (checked with zod) and falls back through a list of
 * models when one is overloaded, out of quota or retired.
 */

const DEFAULT_API = "https://generativelanguage.googleapis.com/v1beta/models";
/** GEMINI_API_URL points the engine at a stand-in server (for testing busy or slow models). */
const api = () => process.env.GEMINI_API_URL?.replace(/\/+$/, "") || DEFAULT_API;

/** Main models, for checking sentences. GEMINI_MODELS (comma-separated) overrides. */
const REVIEW_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
/** Quick models, for reading the document's context. GEMINI_FAST_MODELS overrides. */
const FAST_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"];

const fromEnv = (value: string | undefined, fallback: string[]) => {
  const list = (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
};

/** The models a review tries for checking sentences, in order. */
export const modelChain = () => fromEnv(process.env.GEMINI_MODELS, REVIEW_MODELS);
/** The models used to read the document's context, in order. */
export const fastModelChain = () => fromEnv(process.env.GEMINI_FAST_MODELS, FAST_MODELS);

/** What happened with one model call: answered, or why the next model was tried. */
export type AttemptResult = "ok" | "busy" | "quota" | "missing" | "timeout" | "network" | "bad_reply" | "error";
export type Attempt = { model: string; result: AttemptResult; ms: number; stage?: string };
export type Usage = { input: number | null; output: number | null; thinking: number | null };

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

export function requireKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ReviewUnavailableError("AI review isn’t set up yet: add GEMINI_API_KEY to the server settings.");
  return key;
}

/**
 * One structured call: tries each model in `chain` until one answers in the
 * right shape before `deadline`. Throws ReviewBusyError if none did (or a
 * plain ReviewError if every model hit an unexpected error), and
 * ReviewUnavailableError straight away if the key is missing or rejected.
 */
export async function generateJson<S extends z.ZodType>(opts: {
  stage: string;
  schema: S;
  system: string;
  prompt: string;
  chain: string[];
  /** Epoch ms by which this call must be finished. */
  deadline: number;
  /** Cap for the first model, so the backups still get a turn. */
  firstModelMaxMs?: number;
  maxOutputTokens?: number;
}): Promise<{ data: z.infer<S>; model: string; attempts: Attempt[]; usage: Usage }> {
  const key = requireKey();
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(opts.schema),
      maxOutputTokens: opts.maxOutputTokens ?? 32768,
    },
  });

  const attempts: Attempt[] = [];
  let lastError: unknown;
  for (const [i, model] of opts.chain.entries()) {
    const remaining = opts.deadline - Date.now();
    if (remaining < 8_000) break;
    const timeout = i === 0 && opts.chain.length > 1 && opts.firstModelMaxMs ? Math.min(remaining, opts.firstModelMaxMs) : remaining;
    const started = Date.now();
    try {
      const { json, usage } = await callModel(model, key, body, timeout);
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) throw new TryNextModel("bad_reply", "reply didn’t match the expected format");
      attempts.push({ model, result: "ok", ms: Date.now() - started, stage: opts.stage });
      return { data: parsed.data, model, attempts, usage };
    } catch (err) {
      const ms = Date.now() - started;
      if (err instanceof ReviewUnavailableError) {
        attempts.push({ model, result: "error", ms, stage: opts.stage });
        err.attempts = attempts;
        throw err;
      }
      // Anything else (busy, slow, an odd reply, an unexpected error): the next model may manage.
      const result = err instanceof TryNextModel ? err.result : "error";
      console.warn(`Review (${opts.stage}): ${model} didn’t answer — ${err instanceof Error ? err.message : err}`);
      attempts.push({ model, result, ms, stage: opts.stage });
      lastError = err;
    }
  }
  // Every model was busy, slow or out of quota (or ran into an unexpected error).
  const allErrors = attempts.length > 0 && attempts.every((a) => a.result === "error");
  const failed = allErrors
    ? new ReviewError(lastError instanceof Error ? lastError.message : "Review failed", { cause: lastError })
    : new ReviewBusyError("The AI reviewer is busy right now. Please try again in a minute.", { cause: lastError });
  failed.attempts = attempts;
  throw failed;
}

async function callModel(model: string, key: string, body: string, timeoutMs: number): Promise<{ json: unknown; usage: Usage }> {
  let res: Response;
  try {
    res = await fetch(`${api()}/${encodeURIComponent(model)}:generateContent`, {
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
  // Ran out of room: another model may be more concise.
  if (candidate?.finishReason === "MAX_TOKENS") throw new TryNextModel("bad_reply", "reply was cut off");
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
  const u = json.usageMetadata;
  return {
    json: parsed,
    usage: { input: u?.promptTokenCount ?? null, output: u?.candidatesTokenCount ?? null, thinking: u?.thoughtsTokenCount ?? null },
  };
}
