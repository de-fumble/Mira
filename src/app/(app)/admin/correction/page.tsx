import { ArrowDownRight, ArrowUpRight, CircleCheck, Clock, FileText, LifeBuoy, Minus, SpellCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart } from "@/components/admin/BarChart";
import { EngineTest } from "@/components/admin/EngineTest";
import { Notice } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { getGeminiStatus, type Service } from "@/lib/admin-stats";
import { ISSUE_TYPES, scoreLabel, type IssueType } from "@/lib/documents";
import { formatSeconds } from "@/lib/format-ms";
import { getReviewStats, type ModelHealth, type ReviewStats } from "@/lib/review-stats";
import { formatShortDate, formatTime, getClock, type Clock as ClockT } from "@/lib/time";

export const metadata: Metadata = { title: "Correction engine · Admin" };
// "Run a test review" waits for a real review.
export const maxDuration = 300;

export default function CorrectionEnginePage() {
  return (
    <Suspense fallback={<EngineSkeleton />}>
      <Engine />
    </Suspense>
  );
}

async function Engine() {
  await requireAdmin();
  const clock = await getClock();
  const [status, stats] = await Promise.all([getGeminiStatus(), getReviewStats(clock)]);
  const n = (x: number) => x.toLocaleString(clock.locale);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const { week } = stats;

  return (
    <div className="flex flex-col gap-5">
      {stats.missing && (
        <Notice tone="warn" title="Review history needs a one-time setup">
          Run supabase/migrations/0005_review_runs.sql in the Supabase SQL editor. Until then reviews still work, but they
          aren’t counted here.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Engine + test */}
        <section aria-labelledby="engine" className="card flex flex-col p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="engine" className="flex items-center gap-2 text-[15px] font-semibold text-ink-2">
              <SpellCheck aria-hidden className="h-4 w-4" />
              Correction engine
            </h2>
            <StateBadge state={status.state} />
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {status.detail}
            {status.ms !== undefined && ` · ${status.ms} ms`}
          </p>
          <h3 className="mt-5 text-[13px] font-medium text-ink-3">Models, tried in order</h3>
          <ol className="mt-2 flex flex-col gap-1.5">
            {stats.chain.map((m, i) => (
              <li key={m} className="flex items-center justify-between gap-2 text-[14px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-sunken text-[11px] font-semibold tabular-nums text-ink-3">
                    {i + 1}
                  </span>
                  <code className="truncate">{m}</code>
                </span>
                <span className="flex-none text-[12px] text-ink-3">{i === 0 ? "Main" : "Backup"}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12px] text-ink-4">Change the order with GEMINI_MODELS in the server settings.</p>
          <EngineTest />
        </section>

        {/* Reviews per day */}
        <section aria-labelledby="per-day" className="card p-6 lg:col-span-2">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <h2 id="per-day" className="text-[15px] font-semibold text-ink-2">Reviews per day</h2>
            <span className="text-[13px] text-ink-3">Last 14 days · tests not counted</span>
          </div>
          <BarChart data={stats.daily} unit="review" />
        </section>
      </div>

      {/* This week */}
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <TrendKpi label="Reviews, last 7 days" value={week.reviews} prev={week.prevReviews} />
        <Kpi
          label="Finished"
          value={pct(week.successRate)}
          sub={week.reviews === 0 ? "no reviews yet" : week.notFinished ? `${week.notFinished} didn’t finish` : "every review finished"}
          Icon={CircleCheck}
          warn={week.successRate !== null && week.successRate < 0.9}
        />
        <Kpi
          label="Typical wait"
          value={week.medianMs === null ? "—" : formatSeconds(week.medianMs)}
          sub={week.p90Ms === null ? "median time per review" : `9 in 10 within ${formatSeconds(week.p90Ms)}`}
          Icon={Clock}
          warn={week.medianMs !== null && week.medianMs > 90_000}
        />
        <Kpi
          label="Backup model used"
          value={pct(week.backupShare)}
          sub="main model busy or failed"
          Icon={LifeBuoy}
          warn={week.backupShare !== null && week.backupShare > 0.5}
        />
      </ul>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Models */}
        <section aria-labelledby="models" className="card overflow-hidden lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3 px-6 pb-3 pt-6">
            <h2 id="models" className="text-[15px] font-semibold text-ink-2">Model health</h2>
            <span className="text-[13px] text-ink-3">Last 7 days · tests included</span>
          </div>
          <ModelTable models={stats.models} n={n} />
          <p className="px-6 pb-5 pt-3 text-[12px] text-ink-4">
            Busy = the model was overloaded (503). Out of quota = the key’s limit was reached (429) — turning on billing in Google AI
            Studio raises it.
          </p>
        </section>

        {/* Quality */}
        <section aria-labelledby="quality" className="card p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="quality" className="text-[15px] font-semibold text-ink-2">What it finds</h2>
            <span className="text-[13px] text-ink-3">Last 30 days</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Stat label="Average score" value={stats.month.avgScore === null ? "—" : String(Math.round(stats.month.avgScore))} />
            <Stat
              label="Issues per 1,000 words"
              value={stats.month.issuesPer1000 === null ? "—" : stats.month.issuesPer1000.toFixed(1)}
            />
          </dl>
          <IssueMix types={stats.month.types} n={n} />
          <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-4 text-[13px]">
            <dt className="text-ink-3">Reviews</dt>
            <dd className="text-right font-semibold tabular-nums">{n(stats.month.reviews)}</dd>
            <dt className="text-ink-3">Words reviewed</dt>
            <dd className="text-right font-semibold tabular-nums">{n(stats.month.words)}</dd>
            <dt className="text-ink-3">Tokens in</dt>
            <dd className="text-right font-semibold tabular-nums">{compact(stats.month.tokens.input, clock)}</dd>
            <dt className="text-ink-3">Tokens out</dt>
            <dd className="text-right font-semibold tabular-nums">{compact(stats.month.tokens.output, clock)}</dd>
            <dt className="text-ink-3">Thinking tokens</dt>
            <dd className="text-right font-semibold tabular-nums">{compact(stats.month.tokens.thinking, clock)}</dd>
          </dl>
        </section>
      </div>

      <Recent stats={stats} clock={clock} n={n} />
    </div>
  );
}

/* ------------------------------------------------------------- Pieces */

const compact = (x: number, clock: ClockT) =>
  new Intl.NumberFormat(clock.locale, { notation: "compact", maximumFractionDigits: 1 }).format(x);

function StateBadge({ state }: { state: Service["state"] }) {
  const map = {
    ok: { text: "Working", cls: "text-success", dot: "bg-success" },
    down: { text: "Down", cls: "text-danger", dot: "bg-danger" },
    off: { text: "Not set up", cls: "text-ink-3", dot: "bg-ink-4" },
  } as const;
  const s = map[state];
  return (
    <span className={`inline-flex flex-none items-center gap-1.5 text-[12px] font-semibold ${s.cls}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.text}
    </span>
  );
}

function Kpi({ label, value, sub, Icon, warn = false }: { label: string; value: string; sub: string; Icon: typeof Clock; warn?: boolean }) {
  return (
    <li className="card p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <Icon aria-hidden className="h-4 w-4" />
        {label}
      </p>
      <p className={`mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${warn ? "text-warn" : ""}`}>{value}</p>
      <p className="mt-2 text-[13px] text-ink-3">{sub}</p>
    </li>
  );
}

function TrendKpi({ label, value, prev }: { label: string; value: number; prev: number }) {
  const diff = value - prev;
  const Trend = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <li className="card p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <FileText aria-hidden className="h-4 w-4" />
        {label}
      </p>
      <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</p>
      <p className="mt-2 flex items-center gap-1 text-[13px] text-ink-3">
        <Trend aria-hidden className="h-3.5 w-3.5" />
        {diff === 0 ? "same as the week before" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than the week before`}
      </p>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-sunken/70 px-4 py-3">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ModelTable({ models, n }: { models: ModelHealth[]; n: (x: number) => string }) {
  const cell = (x: number, bad = false) => (
    <span className={x && bad ? "font-semibold text-warn" : x ? "" : "text-ink-4"}>{n(x)}</span>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[14px]">
        <thead className="whitespace-nowrap border-y border-line bg-sunken/60 text-[12px] uppercase tracking-[0.05em] text-ink-3">
          <tr>
            <th scope="col" className="px-6 py-2.5 font-semibold">Model</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Answered</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Avg time</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Busy</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Out of quota</th>
            <th scope="col" className="px-6 py-2.5 text-right font-semibold">Other errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {models.map((m) => (
            <tr key={m.model}>
              <th scope="row" className="whitespace-nowrap px-6 py-3 font-normal">
                <code className="text-[13px]">{m.model}</code>
                <span className="ml-2 text-[12px] text-ink-3">
                  {m.position === 0 ? "Main" : m.position === null ? "No longer used" : `Backup ${m.position}`}
                </span>
              </th>
              <td className="px-3 py-3 text-right">{cell(m.answered)}</td>
              <td className="px-3 py-3 text-right">{m.avgMs === null ? <span className="text-ink-4">—</span> : formatSeconds(m.avgMs)}</td>
              <td className="px-3 py-3 text-right">{cell(m.busy, true)}</td>
              <td className="px-3 py-3 text-right">{cell(m.quota, true)}</td>
              <td className="px-6 py-3 text-right">{cell(m.timeout + m.other, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Share of each issue type — one hue, longest bar = most common. */
function IssueMix({ types, n }: { types: Record<IssueType, number>; n: (x: number) => string }) {
  const entries = (Object.keys(ISSUE_TYPES) as IssueType[]).map((t) => ({ type: t, count: types[t] ?? 0 }));
  const max = Math.max(1, ...entries.map((e) => e.count));
  const total = entries.reduce((s, e) => s + e.count, 0);
  return (
    <div className="mt-5">
      <h3 className="text-[13px] font-medium text-ink-3">Issues by type</h3>
      {total === 0 ? (
        <p className="mt-2 text-[14px] text-ink-3">None yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2.5">
          {entries.map((e) => (
            <li key={e.type} className="text-[13px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink-2">{ISSUE_TYPES[e.type].plural}</span>
                <span className="tabular-nums text-ink-3">
                  {n(e.count)} · {Math.round((e.count / total) * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(e.count / max) * 100}%`, minWidth: e.count ? 4 : 0 }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Recent({ stats, clock, n }: { stats: ReviewStats; clock: ClockT; n: (x: number) => string }) {
  return (
    <section aria-labelledby="recent-reviews" className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-6 pb-3 pt-6">
        <h2 id="recent-reviews" className="text-[15px] font-semibold text-ink-2">Recent reviews</h2>
        <span className="text-[13px] text-ink-3">Document text stays private</span>
      </div>
      {stats.recent.length === 0 ? (
        <p className="px-6 pb-6 text-[14px] text-ink-3">No reviews yet. Run a test review above, or review a document.</p>
      ) : (
        <table className="w-full text-left text-[14px]">
          <thead className="border-y border-line bg-sunken/60 text-[12px] uppercase tracking-[0.05em] text-ink-3 max-sm:sr-only">
            <tr>
              <th scope="col" className="px-6 py-2.5 font-semibold">When</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Words</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Model</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Time</th>
              <th scope="col" className="px-6 py-2.5 text-right font-semibold">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stats.recent.map((r) => (
              <tr key={r.id} className="max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-6 max-sm:py-3.5">
                <td className="whitespace-nowrap px-6 py-3 tabular-nums max-sm:p-0">
                  {formatShortDate(r.at, clock)}, {formatTime(r.at, clock)}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-3 text-ink-2 max-sm:order-3 max-sm:p-0 max-sm:text-[13px]">
                  {r.isTest ? <span className="chip">Test</span> : r.email}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-2 max-sm:hidden">{n(r.words)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink-2 max-sm:order-4 max-sm:p-0 max-sm:text-right max-sm:text-ink-3">
                  {r.model ? <code>{r.model}</code> : <span className="text-ink-4">—</span>}
                  {r.backup && r.model && <span className="ml-1.5 text-ink-3">backup</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-2 max-sm:hidden">{formatSeconds(r.ms)}</td>
                <td className="px-6 py-3 text-right max-sm:order-2 max-sm:p-0">
                  <ResultBadge outcome={r.outcome} score={r.score} issues={r.issues} error={r.error} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ResultBadge({ outcome, score, issues, error }: { outcome: string; score: number | null; issues: number | null; error: string | null }) {
  const pill = "inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold";
  if (outcome === "ok") {
    if (score === null) return <span className={`${pill} bg-success-soft text-success`}>{issues ?? 0} found</span>;
    const tone = scoreLabel(score).tone;
    const cls = { good: "bg-success-soft text-success", ok: "bg-accent-soft text-accent", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger" }[tone];
    return (
      <span className={`${pill} ${cls}`} title={`${issues ?? 0} issues`}>
        Score {score}
      </span>
    );
  }
  const map: Record<string, { text: string; cls: string }> = {
    busy: { text: "Busy", cls: "bg-warn-soft text-warn" },
    unavailable: { text: "Not set up", cls: "bg-sunken text-ink-2" },
    failed: { text: "Failed", cls: "bg-danger-soft text-danger" },
  };
  const s = map[outcome] ?? map.failed;
  return (
    <span className={`${pill} ${s.cls}`} title={error ?? undefined}>
      {s.text}
    </span>
  );
}

function EngineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading correction engine" className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card h-80 p-6">
          <div className="skeleton h-full w-full" />
        </div>
        <div className="card h-80 p-6 lg:col-span-2">
          <div className="skeleton h-full w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-3.5 w-20" />
            <div className="skeleton h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
