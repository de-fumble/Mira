"use client";

import { ArrowRight, CircleCheck, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { ISSUE_TYPES, scoreLabel, type DocAnalysis, type IssueType, type LocatedIssue } from "@/lib/documents";
import { Notice, Spinner } from "../ui";

const DOT: Record<IssueType, string> = {
  spelling: "bg-[#e5372b]",
  grammar: "bg-[#c98a00]",
  unclear: "bg-[#7a3e9d]",
  off_topic: "bg-[#5b6b82]",
};

const TONE = {
  good: { ring: "#1f6b4a", text: "text-success" },
  ok: { ring: "#2f5fd0", text: "text-accent" },
  warn: { ring: "#c98a00", text: "text-warn" },
  bad: { ring: "#b42318", text: "text-danger" },
} as const;

/** AI review: score, summary and the flagged sentences, with fixes. */
export function ReviewPanel({
  documentId,
  analysis,
  located,
  dismissedCount,
  liveScore,
  stale,
  words,
  activeId,
  disabled,
  beforeReview,
  onReviewed,
  onFocus,
  onApply,
  onRemove,
  onDismiss,
}: {
  documentId: string;
  analysis: DocAnalysis | null;
  located: LocatedIssue[];
  dismissedCount: number;
  liveScore: number | null;
  stale: boolean;
  words: number;
  activeId: string | null;
  disabled: boolean;
  beforeReview: () => Promise<boolean>;
  onReviewed: (a: DocAnalysis) => void;
  onFocus: (i: LocatedIssue) => void;
  onApply: (i: LocatedIssue) => void;
  onRemove: (i: LocatedIssue) => void;
  onDismiss: (i: LocatedIssue) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssueType | "all">("all");

  const review = async () => {
    setError(null);
    setReviewing(true);
    try {
      if (!(await beforeReview())) throw new Error("Couldn’t save your latest changes. Please try again.");
      const res = await fetch(`/api/documents/${documentId}/analyze`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { analysis?: DocAnalysis; error?: string };
      if (!res.ok || !body.analysis) throw new Error(body.error ?? "The review didn’t finish. Please try again.");
      onReviewed(body.analysis);
      setFilter("all");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The review didn’t finish. Please try again.");
    } finally {
      setReviewing(false);
    }
  };

  const tooShort = words < 3;
  const counts = located.reduce<Partial<Record<IssueType, number>>>((acc, i) => ({ ...acc, [i.type]: (acc[i.type] ?? 0) + 1 }), {});
  const shown = filter === "all" ? located : located.filter((i) => i.type === filter);
  const fixed = analysis ? Math.max(0, analysis.issues.length - dismissedCount - located.length) : 0;
  const minutes = Math.max(1, Math.round(words / 1500));

  return (
    <aside aria-label="AI review" className="card flex flex-col gap-4 p-5 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink-2">
          <Sparkles aria-hidden className="h-4 w-4" />
          AI review
        </h2>
        {analysis && !reviewing && (
          <button type="button" onClick={review} disabled={disabled || tooShort} className="btn btn-sm btn-ghost -mr-2 gap-1.5 disabled:opacity-40">
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            Review again
          </button>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {reviewing ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-sunken px-4 py-8 text-center" role="status">
          <Spinner className="h-6 w-6 text-ink-3" />
          <p className="text-[15px] font-semibold">Reading your document…</p>
          <p className="text-[13px] leading-relaxed text-ink-3">
            Checking spelling, grammar, and sentences that don’t make sense or don’t fit. This takes about {minutes} {minutes === 1 ? "minute" : "minutes"}.
          </p>
        </div>
      ) : !analysis ? (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] leading-relaxed text-ink-3">
            Mira reads the whole document and flags misspelt or misheard words, grammar slips, sentences that don’t make sense, and ones that don’t belong — then gives it a score.
          </p>
          <button type="button" onClick={review} disabled={disabled || tooShort} className="btn btn-md btn-primary w-full disabled:opacity-40">
            <Sparkles aria-hidden className="h-4 w-4" />
            Review document
          </button>
          {tooShort && <p className="text-center text-[13px] text-ink-4">Write or dictate a few sentences first.</p>}
        </div>
      ) : (
        <>
          <ScoreCard score={liveScore ?? analysis.score} original={analysis.score} fixed={fixed} />
          <p className="text-[14px] leading-relaxed text-ink-2">{analysis.summary}</p>
          {stale && (
            <p className="rounded-xl bg-sunken px-3 py-2 text-[13px] leading-relaxed text-ink-3">
              You’ve edited since this review. Flags follow your edits; run <strong className="font-semibold text-ink-2">Review again</strong> for a fresh check.
            </p>
          )}

          {located.length > 0 ? (
            <>
              <div role="group" aria-label="Show" className="-mx-1 flex flex-wrap gap-1.5">
                <FilterChip on={filter === "all"} onClick={() => setFilter("all")} label="All" count={located.length} />
                {(Object.keys(ISSUE_TYPES) as IssueType[])
                  .filter((t) => counts[t])
                  .map((t) => (
                    <FilterChip key={t} on={filter === t} onClick={() => setFilter(t)} label={ISSUE_TYPES[t].label} count={counts[t]!} dot={DOT[t]} />
                  ))}
              </div>
              <ul className="flex flex-col gap-2">
                {shown.map((i) => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    active={i.id === activeId}
                    disabled={disabled}
                    onFocus={() => onFocus(i)}
                    onApply={() => onApply(i)}
                    onRemove={() => onRemove(i)}
                    onDismiss={() => onDismiss(i)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3.5">
              <CircleCheck aria-hidden className="h-5 w-5 flex-none text-success" />
              <p className="text-[14px] font-medium text-ink">
                {analysis.issues.length ? "All flagged items are dealt with." : "Nothing to fix — this reads cleanly."}
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function ScoreCard({ score, original, fixed }: { score: number; original: number; fixed: number }) {
  const { label, tone } = scoreLabel(score);
  const t = TONE[tone];
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-sunken p-4">
      <div className="relative h-20 w-20 flex-none" role="img" aria-label={`Score ${score} out of 100`}>
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="rgb(0 0 0 / 0.08)" strokeWidth="7" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={t.ring}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            style={{ transition: "stroke-dashoffset 0.6s var(--ease-out)" }}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[24px] font-semibold tabular-nums tracking-tight">{score}</span>
      </div>
      <div className="min-w-0">
        <p className={`text-[16px] font-semibold ${t.text}`}>{label}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
          {score !== original ? `Was ${original} at review` : "Out of 100"}
          {fixed > 0 && ` · ${fixed} fixed`}
        </p>
      </div>
    </div>
  );
}

function FilterChip({ on, onClick, label, count, dot }: { on: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${
        on ? "bg-ink text-white" : "bg-sunken text-ink-2 hover:bg-hover"
      }`}
    >
      {dot && <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />}
      {label}
      <span className={`tabular-nums ${on ? "text-white/70" : "text-ink-4"}`}>{count}</span>
    </button>
  );
}

function IssueCard({
  issue,
  active,
  disabled,
  onFocus,
  onApply,
  onRemove,
  onDismiss,
}: {
  issue: LocatedIssue;
  active: boolean;
  disabled: boolean;
  onFocus: () => void;
  onApply: () => void;
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const wholeSentence = issue.type === "off_topic" || issue.type === "unclear";
  return (
    <li
      ref={(el) => {
        if (active && el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
      className={`rounded-2xl p-3.5 transition ${active ? "bg-surface shadow-[0_0_0_2px_var(--color-ink)]" : "bg-sunken"}`}
    >
      <button type="button" onClick={onFocus} className="block w-full text-left">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[issue.type]}`} />
          {ISSUE_TYPES[issue.type].label}
        </span>
        <span className="mt-1.5 block text-[14px] leading-relaxed">
          <span className={wholeSentence ? "text-ink-2" : "font-medium text-danger line-through decoration-danger/50"}>
            {issue.quote.length > 160 ? `${issue.quote.slice(0, 160)}…` : issue.quote}
          </span>
          {issue.suggestion !== null && !wholeSentence && (
            <>
              <ArrowRight aria-hidden className="mx-1.5 inline h-3.5 w-3.5 text-ink-4" />
              <span className="font-semibold text-success">{issue.suggestion || "(remove)"}</span>
            </>
          )}
        </span>
        {issue.suggestion !== null && wholeSentence && (
          <span className="mt-1.5 block rounded-lg bg-success-soft px-2.5 py-1.5 text-[13px] leading-relaxed text-ink">
            <span className="font-semibold text-success">Suggested: </span>
            {issue.suggestion}
          </span>
        )}
        <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-3">{issue.explanation}</span>
      </button>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {issue.suggestion !== null ? (
          <button type="button" disabled={disabled} onClick={onApply} className="btn h-8 rounded-full bg-ink px-3 text-[13px] text-white hover:bg-black disabled:opacity-40">
            {issue.suggestion ? "Apply fix" : "Remove"}
          </button>
        ) : (
          issue.type === "off_topic" && (
            <button type="button" disabled={disabled} onClick={onRemove} className="btn h-8 rounded-full bg-ink px-3 text-[13px] text-white hover:bg-black disabled:opacity-40">
              Remove sentence
            </button>
          )
        )}
        {issue.suggestion === null && issue.type !== "off_topic" && (
          <button type="button" onClick={onFocus} className="btn h-8 rounded-full bg-surface px-3 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-hover">
            Edit in text
          </button>
        )}
        <button type="button" onClick={onDismiss} className="btn h-8 rounded-full px-3 text-[13px] text-ink-3 hover:bg-hover hover:text-ink">
          Keep as is
        </button>
      </div>
    </li>
  );
}
