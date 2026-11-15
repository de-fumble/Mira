import {
  ArrowDownRight,
  ArrowUpRight,
  AudioLines,
  CircleCheck,
  CircleExclamationPoint,
  Clock,
  CreditCard,
  Database,
  ExternalLink,
  HardDrive,
  Mic,
  Minus,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart } from "@/components/admin/BarChart";
import { Notice } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { getClaudeStatus, getDeepgramStatus, getSubscriptionStats, getUsageStats, type Service, type SubscriptionStats, type UsageStats } from "@/lib/admin-stats";
import { formatNaira } from "@/lib/billing-rules";
import { FEATURES, getFeatureRows } from "@/lib/features";
import { formatShortDate, formatTime, getClock, type Clock as ClockT } from "@/lib/time";
import { formatDuration } from "@/lib/transcript";

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await requireAdmin();
  const clock = await getClock();
  const [deepgram, claude, usage, settings, subs] = await Promise.all([
    getDeepgramStatus(),
    getClaudeStatus(),
    getUsageStats(clock),
    getFeatureRows(),
    getSubscriptionStats(),
  ]);

  const services: (Service & { Icon: typeof Database })[] = [
    { ...usage.database, Icon: Database },
    { ...deepgram.service, Icon: Mic },
    { ...claude, Icon: Sparkles },
    { ...usage.storage, Icon: HardDrive },
  ];
  const down = services.filter((s) => s.state === "down");
  const notSetUp = services.filter((s) => s.state === "off");
  const lowBalance = deepgram.balanceUsd !== null && deepgram.balanceUsd < deepgram.lowBalanceUsd;
  const issues = down.length + (lowBalance ? 1 : 0) + usage.attention.unfinished + usage.attention.stuckNotes;
  const checkedAt = formatTime(new Date().toISOString(), clock);
  // "$199.99" in every locale (not "US$199.99").
  const usd = (n: number) =>
    new Intl.NumberFormat(clock.locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).format(n);

  return (
    <div className="flex flex-col gap-5">
      {/* Overall */}
      <div
        className={`flex animate-fade-up flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] px-5 py-4 ${
          issues ? "bg-warn-soft" : "bg-success-soft"
        }`}
      >
        <p className="flex items-center gap-2.5 text-[16px] font-semibold">
          {issues ? (
            <CircleExclamationPoint aria-hidden className="h-5 w-5 text-warn" />
          ) : (
            <CircleCheck aria-hidden className="h-5 w-5 text-success" />
          )}
          {issues ? `${issues} ${issues === 1 ? "thing needs" : "things need"} attention` : "All systems normal"}
        </p>
        <p className="text-[13px] text-ink-3">Checked at {checkedAt}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Deepgram balance */}
        <section aria-labelledby="balance" className="card flex flex-col p-6">
          <div className="flex items-center justify-between">
            <h2 id="balance" className="text-[15px] font-semibold text-ink-2">Deepgram balance</h2>
            <span className="chip">
              <AudioLines aria-hidden className="h-3.5 w-3.5" />
              Transcription
            </span>
          </div>
          {deepgram.balanceUsd !== null ? (
            <>
              <p className="mt-4 text-[44px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                {usd(deepgram.balanceUsd)}
              </p>
              <p className="mt-2 text-[14px] text-ink-3">remaining credit</p>
              <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5 text-[14px]">
                <div>
                  <dt className="text-ink-3">This month</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{formatHours(deepgram.monthHours)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Requests</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{deepgram.monthRequests.toLocaleString(clock.locale)}</dd>
                </div>
              </dl>
              {lowBalance && (
                <Notice tone="warn" title="Balance is running low" className="mt-5">
                  Below {usd(deepgram.lowBalanceUsd)}. Top up so recordings keep working.
                </Notice>
              )}
            </>
          ) : (
            <p className="mt-4 text-[15px] text-ink-3">
              {deepgram.service.state === "off" ? "Add DEEPGRAM_API_KEY to see the balance." : `Couldn’t read the balance: ${deepgram.service.detail}.`}
            </p>
          )}
          <a
            href="https://console.deepgram.com/billing"
            target="_blank"
            rel="noreferrer"
            className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[14px] font-medium text-accent hover:underline"
          >
            Open Deepgram billing
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
        </section>

        {/* Services */}
        <section aria-labelledby="services" className="card p-6 lg:col-span-2">
          <h2 id="services" className="text-[15px] font-semibold text-ink-2">Services</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.name} className="flex items-start gap-3.5 rounded-2xl bg-sunken/70 p-4">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-surface text-ink-2 shadow-[var(--shadow-card)]">
                  <s.Icon aria-hidden className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold">{s.name}</span>
                    <StateBadge state={s.state} />
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-3">
                    {s.detail}
                    {s.ms !== undefined && ` · ${s.ms} ms`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {notSetUp.length > 0 && (
            <p className="mt-4 text-[13px] text-ink-3">
              “Not set up” means the API key isn’t in <code className="rounded bg-sunken px-1">.env.local</code> yet.
            </p>
          )}
        </section>
      </div>

      {/* Numbers */}
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        <Kpi label="Accounts" value={usage.users.total.toLocaleString(clock.locale)} sub={`+${usage.users.newThisWeek} this week`} Icon={Users} />
        <Kpi label="Meetings" value={usage.meetings.total.toLocaleString(clock.locale)} sub={`avg ${Math.round(usage.meetings.avgMinutes)} min long`} Icon={AudioLines} />
        <Kpi label="Hours recorded" value={usage.meetings.hours < 10 ? usage.meetings.hours.toFixed(1) : Math.round(usage.meetings.hours).toLocaleString(clock.locale)} sub="all time" Icon={Clock} />
        <WeekKpi stats={usage} />
      </ul>

      <Subscriptions subs={subs} billingOn={settings.features.billing} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Chart */}
        <section aria-labelledby="per-day" className="card p-6 lg:col-span-2">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <h2 id="per-day" className="text-[15px] font-semibold text-ink-2">Recordings per day</h2>
            <span className="text-[13px] text-ink-3">Last 14 days</span>
          </div>
          <BarChart data={usage.daily} />
        </section>

        {/* Attention + features */}
        <section aria-labelledby="attention" className="card flex flex-col p-6">
          <h2 id="attention" className="text-[15px] font-semibold text-ink-2">Needs attention</h2>
          <ul className="mt-3 flex flex-col gap-2 text-[14px]">
            <AttentionRow count={usage.attention.unfinished} text="recordings that never finished saving" />
            <AttentionRow count={usage.attention.stuckNotes} text="meetings stuck on “writing notes” for over an hour" />
            {down.map((s) => (
              <AttentionRow key={s.name} count={1} text={`${s.name}: ${s.detail}`} />
            ))}
            {lowBalance && <AttentionRow count={1} text="Deepgram balance is low" />}
            {!issues && <li className="text-ink-3">Nothing right now.</li>}
          </ul>

          <div className="mt-6 border-t border-line pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-2">Features</h3>
              <Link href="/admin/features" className="text-[14px] font-medium text-accent hover:underline">
                Manage
              </Link>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {FEATURES.map((f) => {
                const on = settings.features[f.key];
                const warn = f.key === "maintenance" ? on : !on;
                return (
                  <li key={f.key} className="flex items-center justify-between text-[14px]">
                    <span>{f.label}</span>
                    <span className={`inline-flex items-center gap-1.5 font-medium ${warn ? "text-warn" : "text-ink-3"}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${warn ? "bg-warn" : on ? "bg-success" : "bg-ink-4"}`} />
                      {on ? "On" : "Off"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      {/* Recent activity (no meeting content — just what's needed to monitor) */}
      <section aria-labelledby="recent" className="card overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 px-6 pb-3 pt-6">
          <h2 id="recent" className="text-[15px] font-semibold text-ink-2">Recent recordings</h2>
          <span className="text-[13px] text-ink-3">Titles and transcripts stay private</span>
        </div>
        {usage.recent.length === 0 ? (
          <p className="px-6 pb-6 text-[14px] text-ink-3">No recordings yet.</p>
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead className="border-y border-line bg-sunken/60 text-[12px] uppercase tracking-[0.05em] text-ink-3 max-sm:sr-only">
              <tr>
                <th scope="col" className="px-6 py-2.5 font-semibold">When</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Account</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Length</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-6 py-2.5 text-right font-semibold">Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.recent.map((r) => (
                <tr key={r.id} className="max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:px-6 max-sm:py-3.5">
                  <td className="whitespace-nowrap px-6 py-3 tabular-nums max-sm:p-0">
                    <When iso={r.startedAt} clock={clock} />
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-3 text-ink-2 max-sm:order-3 max-sm:col-span-2 max-sm:p-0 max-sm:text-[13px]">
                    {r.email}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink-2 max-sm:hidden">{formatDuration(r.duration)}</td>
                  <td className="px-3 py-3 max-sm:p-0 max-sm:text-right">
                    <MeetingStatusBadge status={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-[13px] text-ink-3 max-sm:hidden">
                    {[r.audio && "Audio", r.notes && "Notes"].filter(Boolean).join(" · ") || "Transcript"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- Pieces */

function formatHours(h: number) {
  if (h === 0) return "0 h";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h.toFixed(1)} h`;
}

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

function MeetingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; cls: string }> = {
    ready: { text: "Ready", cls: "bg-success-soft text-success" },
    processing: { text: "Writing notes", cls: "bg-accent-soft text-accent" },
    recording: { text: "Unfinished", cls: "bg-warn-soft text-warn" },
    failed: { text: "Failed", cls: "bg-danger-soft text-danger" },
  };
  const s = map[status] ?? { text: status, cls: "bg-sunken text-ink-2" };
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold ${s.cls}`}>{s.text}</span>;
}

function Subscriptions({ subs, billingOn }: { subs: SubscriptionStats; billingOn: boolean }) {
  const items = [
    { label: "On free trial", value: subs.trialing },
    { label: "Paying", value: subs.active },
    { label: "Cancelling", value: subs.cancelling },
    { label: "Payment failed", value: subs.failed },
  ];
  return (
    <section aria-labelledby="subs" className="card animate-fade-up overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-0">
        <h2 id="subs" className="flex items-center gap-2 text-[15px] font-semibold text-ink-2">
          <CreditCard aria-hidden className="h-4 w-4" />
          Subscriptions
        </h2>
        <span className={`chip ${billingOn ? "" : "text-ink-3"}`}>{billingOn ? "Billing on" : "Billing off · Mira is free"}</span>
      </div>
      {subs.missing ? (
        <p className="p-6 text-[14px] text-ink-3">Run supabase/migrations/0003_subscriptions.sql in Supabase to start taking subscriptions.</p>
      ) : (
        <div className="grid gap-5 p-6 md:grid-cols-[220px_1fr] md:items-center">
          <div>
            <p className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{formatNaira(subs.monthlyNaira)}</p>
            <p className="mt-2 text-[14px] text-ink-3">monthly revenue from paying subscribers</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((i) => (
              <div key={i.label} className="rounded-2xl bg-sunken/70 px-4 py-3">
                <dt className="text-[13px] text-ink-3">{i.label}</dt>
                <dd className={`mt-0.5 text-[22px] font-semibold tabular-nums ${i.label === "Payment failed" && i.value ? "text-danger" : ""}`}>{i.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, Icon }: { label: string; value: string; sub: string; Icon: typeof Users }) {
  return (
    <li className="card p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <Icon aria-hidden className="h-4 w-4" />
        {label}
      </p>
      <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</p>
      <p className="mt-2 text-[13px] text-ink-3">{sub}</p>
    </li>
  );
}

function WeekKpi({ stats }: { stats: UsageStats }) {
  const { thisWeek, lastWeek } = stats.meetings;
  const diff = thisWeek - lastWeek;
  const Trend = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <li className="card p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <Mic aria-hidden className="h-4 w-4" />
        Last 7 days
      </p>
      <p className="mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{thisWeek}</p>
      <p className="mt-2 flex items-center gap-1 text-[13px] text-ink-3">
        <Trend aria-hidden className="h-3.5 w-3.5" />
        {diff === 0 ? "same as the week before" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than the week before`}
      </p>
    </li>
  );
}

function AttentionRow({ count, text }: { count: number; text: string }) {
  if (!count) return null;
  return (
    <li className="flex items-start gap-2.5">
      <CircleExclamationPoint aria-hidden className="mt-0.5 h-4 w-4 flex-none text-warn" />
      <span>
        {count > 1 && <strong className="font-semibold">{count} </strong>}
        {text}
      </span>
    </li>
  );
}

function When({ iso, clock }: { iso: string; clock: ClockT }) {
  return (
    <span>
      {formatShortDate(iso, clock)}, {formatTime(iso, clock)}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="flex flex-col gap-5">
      <div className="skeleton h-14 w-full rounded-[var(--radius-card)]" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card space-y-4 p-6">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-11 w-40" />
          <div className="skeleton h-4 w-24" />
        </div>
        <div className="card grid gap-3 p-6 sm:grid-cols-2 lg:col-span-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[72px] rounded-2xl" />
          ))}
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
      <div className="card h-64 p-6">
        <div className="skeleton h-full w-full" />
      </div>
    </div>
  );
}
