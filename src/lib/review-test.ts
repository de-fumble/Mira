import "server-only";
import { countWords } from "./documents";
import { runReview } from "./review/pipeline";
import { logReview, outcomeOf, type ReviewOutcome } from "./review-log";

/** A short paragraph with nine planted mistakes, like a rushed dictation. */
const SAMPLE =
  "Their going to recieve the report tomorow. The revenue have grown by 18%, which are above target. " +
  "Please review the the attached budget before friday. Hold on, let me get the door. The cat is blue sky running.";

/** Each planted mistake, matched against “quote → suggestion” (and the sentence). */
const PLANTED: { label: string; test: RegExp }[] = [
  { label: "Their → They’re", test: /Their.*→.*(They['’]re|They are)/i },
  { label: "recieve", test: /recieve/ },
  { label: "tomorow", test: /tomorow/ },
  { label: "revenue have → has", test: /have.*→.*has/ },
  { label: "which are → is", test: /are.*→.*is/ },
  { label: "the the", test: /the the/i },
  { label: "friday → Friday", test: /friday.*→.*Friday/ },
  { label: "stray “let me get the door”", test: /Hold on/ },
  { label: "nonsense sentence", test: /blue sky/ },
];

export type EngineTestResult =
  | { ok: true; model: string; backup: boolean; ms: number; caught: number; total: number; missed: string[]; extra: number }
  | { ok: false; outcome: ReviewOutcome; error: string; ms: number };

/** Runs one real review on the sample and logs it as a test. */
export async function runEngineTest(userId: string | null): Promise<EngineTestResult> {
  const words = countWords(SAMPLE);
  const started = Date.now();
  try {
    const { issues, meta } = await runReview({ title: "Test review", content: SAMPLE });
    const ms = Date.now() - started;
    await logReview({ userId, documentId: null, isTest: true, words, durationMs: ms, meta, issues, score: null });
    const lines = issues.map((i) => `${i.quote} → ${i.suggestion ?? ""} || ${i.sentence}`);
    const hit = PLANTED.filter((p) => lines.some((l) => p.test.test(l)));
    return {
      ok: true,
      model: meta.model,
      backup: meta.fellBack,
      ms,
      caught: hit.length,
      total: PLANTED.length,
      missed: PLANTED.filter((p) => !hit.includes(p)).map((p) => p.label),
      extra: Math.max(0, issues.length - hit.length),
    };
  } catch (err) {
    const ms = Date.now() - started;
    await logReview({ userId, documentId: null, isTest: true, words, durationMs: ms, error: err });
    return { ok: false, outcome: outcomeOf(err), error: err instanceof Error ? err.message : "The review failed.", ms };
  }
}
