import "server-only";
import { ISSUE_TYPES, type IssueType } from "./documents";
import { modelChain, type Attempt } from "./proofread";
import type { ReviewOutcome } from "./review-log";
import { createAdminClient } from "./supabase/admin";
import { dailyCounts, type Clock, type DayCount } from "./time";

type RunRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  is_test: boolean;
  outcome: ReviewOutcome;
  model: string | null;
  attempts: Attempt[] | null;
  duration_ms: number;
  words: number;
  issues: number | null;
  issue_types: Partial<Record<IssueType, number>> | null;
  score: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  error: string | null;
};

export type ModelHealth = {
  model: string;
  /** 0 = main model, 1+ = backups, null = no longer in the list */
  position: number | null;
  answered: number;
  avgMs: number | null;
  busy: number;
  quota: number;
  timeout: number;
  other: number;
};

export type ReviewStats = {
  missing: boolean;
  chain: string[];
  week: {
    reviews: number;
    prevReviews: number;
    ok: number;
    notFinished: number;
    successRate: number | null;
    medianMs: number | null;
    p90Ms: number | null;
    backupShare: number | null;
  };
  daily: DayCount[];
  models: ModelHealth[];
  month: {
    reviews: number;
    words: number;
    avgScore: number | null;
    issuesPer1000: number | null;
    types: Record<IssueType, number>;
    tokens: { input: number; output: number; thinking: number };
  };
  recent: {
    id: string;
    at: string;
    email: string;
    isTest: boolean;
    outcome: ReviewOutcome;
    model: string | null;
    backup: boolean;
    words: number;
    issues: number | null;
    score: number | null;
    ms: number;
    error: string | null;
  }[];
};

const DAY = 86_400_000;

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;

/** Correction engine numbers for the admin dashboard, from the review log. */
export async function getReviewStats(clock: Clock): Promise<ReviewStats> {
  const admin = createAdminClient();
  const now = Date.now();
  const chain = modelChain();
  const [{ data, error }, usersRes] = await Promise.all([
    admin
      .from("review_runs")
      .select("*")
      .gte("created_at", new Date(now - 30 * DAY).toISOString())
      .order("created_at", { ascending: false })
      .limit(5000)
      .returns<RunRow[]>(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const rows = data ?? [];
  const since = (days: number, until = 0) => (r: RunRow) => {
    const t = new Date(r.created_at).getTime();
    return t >= now - days * DAY && t < now - until * DAY;
  };
  const real = rows.filter((r) => !r.is_test);
  const week = real.filter(since(7));
  const weekOk = week.filter((r) => r.outcome === "ok");
  const times = weekOk.map((r) => r.duration_ms).sort((a, b) => a - b);

  // Model health counts every review, tests included: it's about the engine.
  const health = new Map<string, ModelHealth>();
  const entry = (model: string) => {
    let h = health.get(model);
    if (!h) {
      const pos = chain.indexOf(model);
      h = { model, position: pos >= 0 ? pos : null, answered: 0, avgMs: null, busy: 0, quota: 0, timeout: 0, other: 0 };
      health.set(model, h);
    }
    return h;
  };
  chain.forEach(entry);
  const okMs = new Map<string, number[]>();
  for (const r of rows.filter(since(7))) {
    for (const a of r.attempts ?? []) {
      const h = entry(a.model);
      if (a.result === "ok") {
        h.answered++;
        okMs.set(a.model, [...(okMs.get(a.model) ?? []), a.ms]);
      } else if (a.result === "busy") h.busy++;
      else if (a.result === "quota") h.quota++;
      else if (a.result === "timeout") h.timeout++;
      else h.other++;
    }
  }
  for (const [model, list] of okMs) entry(model).avgMs = list.reduce((s, x) => s + x, 0) / list.length;
  const models = [...health.values()].sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || b.answered - a.answered);

  const month = real.filter((r) => r.outcome === "ok");
  const types = Object.fromEntries(Object.keys(ISSUE_TYPES).map((t) => [t, 0])) as Record<IssueType, number>;
  for (const r of month) for (const t of Object.keys(types) as IssueType[]) types[t] += r.issue_types?.[t] ?? 0;
  const monthWords = month.reduce((s, r) => s + r.words, 0);
  const monthIssues = month.reduce((s, r) => s + (r.issues ?? 0), 0);
  const scored = month.filter((r) => r.score !== null);

  const emailById = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? "unknown"]));

  return {
    missing: Boolean(error),
    chain,
    week: {
      reviews: week.length,
      prevReviews: real.filter(since(14, 7)).length,
      ok: weekOk.length,
      notFinished: week.length - weekOk.length,
      successRate: week.length ? weekOk.length / week.length : null,
      medianMs: percentile(times, 0.5),
      p90Ms: percentile(times, 0.9),
      backupShare: weekOk.length ? weekOk.filter((r) => (r.attempts?.length ?? 1) > 1).length / weekOk.length : null,
    },
    daily: dailyCounts(
      real.map((r) => r.created_at),
      14,
      clock,
      now,
    ),
    models,
    month: {
      reviews: month.length,
      words: monthWords,
      avgScore: scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null,
      issuesPer1000: monthWords ? (monthIssues / monthWords) * 1000 : null,
      types,
      tokens: {
        input: month.reduce((s, r) => s + (r.input_tokens ?? 0), 0),
        output: month.reduce((s, r) => s + (r.output_tokens ?? 0), 0),
        thinking: month.reduce((s, r) => s + (r.thinking_tokens ?? 0), 0),
      },
    },
    recent: rows.slice(0, 12).map((r) => ({
      id: r.id,
      at: r.created_at,
      email: r.user_id ? (emailById.get(r.user_id) ?? "deleted user") : "deleted user",
      isTest: r.is_test,
      outcome: r.outcome,
      model: r.model,
      backup: (r.attempts?.length ?? 1) > 1,
      words: r.words,
      issues: r.issues,
      score: r.score,
      ms: r.duration_ms,
      error: r.error,
    })),
  };
}

/** Reviews by users that didn't finish in the last 24 hours (for "Needs attention"). */
export async function getRecentReviewFailures(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("review_runs")
    .select("id", { count: "exact", head: true })
    .eq("is_test", false)
    .neq("outcome", "ok")
    .gte("created_at", new Date(Date.now() - DAY).toISOString());
  return error ? 0 : (count ?? 0);
}
