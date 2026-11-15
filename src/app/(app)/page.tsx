import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Circle,
  Clock,
  FileText,
  ListChecks,
  Mic,
  Minus,
  Sparkles,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";
import { BarChart } from "@/components/admin/BarChart";
import { MobileRecordButton } from "@/components/AppHeader";
import { MeetingCard, type MeetingCardData } from "@/components/MeetingCard";
import { SearchField } from "@/components/SearchField";
import { Notice } from "@/components/ui";
import { displayName } from "@/lib/account";
import { getViewer } from "@/lib/admin";
import { syncIfDue } from "@/lib/billing";
import { getFeatures } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { dailyCounts, dayGroup, formatDate, formatShortDate, formatTime, getClock, greeting, type Clock as ClockT } from "@/lib/time";
import { formatDuration, type MeetingStatus, type MeetingSummary } from "@/lib/transcript";

const DAY = 86_400_000;

export default function HomePage(props: PageProps<"/">) {
  return (
    <>
      <div className="mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
        <Suspense fallback={<HeadingSkeleton />}>
          <Greeting />
        </Suspense>
        <Suspense fallback={<div className="h-11 w-full rounded-[14px] bg-surface sm:w-80" />}>
          <SearchField />
        </Suspense>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Greeting() {
  const [viewer, clock] = await Promise.all([getViewer(), getClock()]);
  // After the page is sent: if a renewal is due, ask Paystack whether it went through.
  if (viewer.id && !viewer.isAdmin) after(() => syncIfDue(viewer.id!));
  const now = new Date();
  return (
    <div className="min-w-0">
      <p className="eyebrow">{formatDate(now.toISOString(), clock)}</p>
      <h1 className="mt-1.5 truncate text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[38px]">
        {greeting(clock, now)}, {displayName(viewer.username, viewer.email)}
      </h1>
    </div>
  );
}

type Row = {
  id: string;
  title: string;
  status: MeetingStatus;
  started_at: string;
  duration_seconds: number | null;
  snippet: string | null;
  key_points: MeetingSummary["key_points"] | null;
  action_items: MeetingSummary["action_items"] | null;
};

const toCard = (m: Row, clock: ClockT): MeetingCardData => ({
  id: m.id,
  title: m.title,
  status: m.status,
  time: formatTime(m.started_at, clock),
  duration: formatDuration(m.duration_seconds),
  snippet: m.snippet,
});

/** All the dashboard numbers, from the newest-first meeting rows. */
function summarize(data: Row[], clock: ClockT) {
  const now = Date.now();
  const age = (m: Row) => now - new Date(m.started_at).getTime();
  const thisWeek = data.filter((m) => age(m) < 7 * DAY);
  const lastWeek = data.filter((m) => age(m) >= 7 * DAY && age(m) < 14 * DAY);
  const secs = (rows: Row[]) => rows.reduce((s, m) => s + (m.duration_seconds ?? 0), 0);
  const timed = data.filter((m) => m.duration_seconds);
  const avg = timed.length ? secs(timed) / timed.length : 0;
  const actions = data.flatMap((m) =>
    (Array.isArray(m.action_items) ? m.action_items : []).map((a) => ({ ...a, meetingId: m.id, meetingTitle: m.title, at: m.started_at })),
  );
  const notesReady = data.filter((m) => m.snippet).length;
  const latest = data[0];
  const daily = dailyCounts(
    data.map((m) => m.started_at),
    14,
    clock,
    now,
  );
  const fortnight = daily.reduce((s, d) => s + d.count, 0);
  return { thisWeek, lastWeek, secs, avg, actions, notesReady, latest, daily, fortnight };
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const raw = (await searchParams).q;
  // Strip characters that have meaning in PostgREST filter syntax.
  const q = typeof raw === "string" ? raw.replace(/[,()*%\\]/g, " ").trim() : "";

  const [supabase, clock, features] = await Promise.all([createClient(), getClock(), getFeatures()]);
  let query = supabase
    .from("meetings")
    .select(
      "id, title, status, started_at, duration_seconds, snippet:summary->>summary, key_points:summary->key_points, action_items:summary->action_items",
    )
    .order("started_at", { ascending: false })
    .limit(q ? 100 : 300);
  if (q) query = query.or(`title.ilike.*${q}*,transcript_text.ilike.*${q}*`);
  const { data, error } = await query.returns<Row[]>();

  if (error) return <Notice tone="error" title="Couldn’t load your meetings">{error.message}</Notice>;

  if (q) {
    return (
      <>
        {data.length ? (
          <div className="flex flex-col gap-5">
            <p className="text-[15px] text-ink-3">
              {data.length} {data.length === 1 ? "result" : "results"} for “{q}”
            </p>
            <GroupedList rows={data} clock={clock} />
          </div>
        ) : (
          <NoResults q={q} />
        )}
        {features.recording && <MobileRecordButton />}
      </>
    );
  }

  if (!data.length) return <EmptyState recording={features.recording} />;

  const { thisWeek, lastWeek, secs, avg, actions, notesReady, latest, daily, fortnight } = summarize(data, clock);

  return (
    <div className="flex flex-col gap-5">
      {/* KPI row */}
      <ul aria-label="Your numbers" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat index={0} Icon={CalendarDays} label="This week" value={String(thisWeek.length)} unit={thisWeek.length === 1 ? "meeting" : "meetings"}>
          <Trend now={thisWeek.length} before={lastWeek.length} />
        </Stat>
        <Stat index={1} Icon={Clock} label="Time recorded" value={secs(thisWeek) ? formatDuration(secs(thisWeek)) : "0 min"}>
          <span className="text-ink-3">in the last 7 days</span>
        </Stat>
        <Stat index={2} Icon={Timer} label="Average length" value={avg ? formatDuration(avg) : "—"}>
          <span className="text-ink-3">
            across {data.length} {data.length === 1 ? "meeting" : "meetings"}
          </span>
        </Stat>
        <Stat index={3} Icon={ListChecks} label="Action items" value={String(actions.length)}>
          <span className="text-ink-3">
            from {notesReady} {notesReady === 1 ? "set" : "sets"} of notes
          </span>
        </Stat>
      </ul>

      {/* Phones/tablets: latest → side panels → list. Desktop: two columns, panels on the right. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <LatestMeeting m={latest} clock={clock} aiNotes={features.ai_notes} />
        </div>

        <aside className="grid items-start gap-5 sm:grid-cols-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid-cols-1 lg:self-start lg:sticky lg:top-24">
          <RecordCard recording={features.recording} />
          <Panel id="activity" title="Activity" aside={<span className="text-[13px] text-ink-3">Last 14 days</span>}>
            <p className="-mt-1 mb-4 text-[14px] text-ink-3">
              <span className="text-[22px] font-semibold tabular-nums tracking-tight text-ink">{fortnight}</span>{" "}
              {fortnight === 1 ? "meeting" : "meetings"}
            </p>
            <BarChart data={daily} unit="meeting" />
          </Panel>
          <ActionItems items={actions.slice(0, 5)} total={actions.length} clock={clock} aiNotes={features.ai_notes} />
        </aside>

        <section aria-labelledby="all-meetings" className="min-w-0 animate-fade-up lg:col-start-1 lg:row-start-2">
          <div className="mb-4 mt-3 flex items-baseline justify-between px-1">
            <h2 id="all-meetings" className="text-[20px] font-semibold tracking-tight">
              All meetings
            </h2>
            <span className="text-[14px] tabular-nums text-ink-3">{data.length}</span>
          </div>
          <GroupedList rows={data} clock={clock} />
        </section>
      </div>

      {features.recording && <MobileRecordButton />}
    </div>
  );
}

function Stat({
  Icon,
  label,
  value,
  unit,
  index,
  children,
}: {
  Icon: typeof Clock;
  label: string;
  value: string;
  unit?: string;
  index: number;
  children: ReactNode;
}) {
  return (
    <li className="card stagger flex min-w-0 flex-col p-4 sm:p-5" style={{ "--i": index } as React.CSSProperties}>
      <span className="flex items-center gap-2 text-[13px] font-medium text-ink-3 sm:text-[14px]">
        <Icon aria-hidden className="h-4 w-4 flex-none" />
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span className="truncate text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[30px]">{value}</span>
        {unit && <span className="text-[14px] text-ink-3">{unit}</span>}
      </span>
      <span className="mt-2 truncate text-[13px]">{children}</span>
    </li>
  );
}

function Trend({ now, before }: { now: number; before: number }) {
  const diff = now - before;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-ink-3">
      <Icon aria-hidden className={`h-3.5 w-3.5 ${diff > 0 ? "text-success" : ""}`} />
      {diff === 0 ? "Same as last week" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last week`}
    </span>
  );
}

function Panel({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card animate-fade-up p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold text-ink-2">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function LatestMeeting({ m, clock, aiNotes }: { m: Row; clock: ClockT; aiNotes: boolean }) {
  const points = (Array.isArray(m.key_points) ? m.key_points : []).slice(0, 3);
  const actionCount = Array.isArray(m.action_items) ? m.action_items.length : 0;
  return (
    <section aria-labelledby="latest" className="card animate-fade-up overflow-hidden">
      <div className="p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Latest meeting</p>
          <span className="chip">
            <AudioLines aria-hidden className="h-3.5 w-3.5" />
            {formatDuration(m.duration_seconds)}
          </span>
        </div>
        <h2 id="latest" className="mt-3 text-[22px] font-semibold leading-snug tracking-[-0.02em] sm:text-[26px]">
          <Link href={`/meetings/${m.id}`} className="hover:underline hover:decoration-line-strong hover:underline-offset-4">
            {m.title}
          </Link>
        </h2>
        <p className="mt-1 text-[14px] text-ink-3">
          {dayGroup(m.started_at, new Date(), clock)} at {formatTime(m.started_at, clock)}
        </p>

        {m.status === "processing" ? (
          <p className="mt-5 inline-flex items-center gap-2 text-[15px] text-accent">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Writing notes…
          </p>
        ) : m.snippet ? (
          <p className="mt-5 line-clamp-3 text-[16px] leading-relaxed text-ink-2">{m.snippet}</p>
        ) : (
          <p className="mt-5 text-[15px] text-ink-3">
            {aiNotes ? "No notes yet — open the meeting to write them." : "Open the meeting to read the full transcript."}
          </p>
        )}

        {points.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[15px] text-ink-2">
                <span aria-hidden className="mt-[9px] h-1.5 w-1.5 flex-none rounded-full bg-ink-4" />
                <span className="line-clamp-2">{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken/60 px-5 py-3.5 sm:px-7">
        <span className="flex items-center gap-4 text-[13px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <FileText aria-hidden className="h-3.5 w-3.5" />
            Transcript
          </span>
          {actionCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <ListChecks aria-hidden className="h-3.5 w-3.5" />
              {actionCount} action {actionCount === 1 ? "item" : "items"}
            </span>
          )}
        </span>
        <Link href={`/meetings/${m.id}`} className="btn btn-sm btn-secondary">
          Open meeting
          <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function RecordCard({ recording }: { recording: boolean }) {
  return (
    <section aria-label="New recording" className="relative hidden animate-fade-up overflow-hidden rounded-[var(--radius-card)] bg-ink p-5 text-white shadow-[var(--shadow-card)] lg:block">
      <span aria-hidden className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/[0.06]" />
      <span aria-hidden className="absolute -right-2 -top-2 h-20 w-20 rounded-full bg-white/[0.06]" />
      <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-white/10">
        <Mic aria-hidden className="h-5 w-5" />
      </span>
      <h2 className="relative mt-4 text-[18px] font-semibold tracking-tight">{recording ? "Ready when you are" : "Recording is paused"}</h2>
      <p className="relative mt-1 text-[14px] leading-relaxed text-white/65">
        {recording ? "Start recording and Mira writes down every word as people speak." : "New recordings are switched off for now. Your meetings are still here."}
      </p>
      {recording && (
        <Link href="/record" className="btn btn-md relative mt-5 w-full bg-white text-ink hover:bg-white/90">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-rec" />
          Start recording
        </Link>
      )}
    </section>
  );
}

type Action = MeetingSummary["action_items"][number] & { meetingId: string; meetingTitle: string; at: string };

function ActionItems({ items, total, clock, aiNotes }: { items: Action[]; total: number; clock: ClockT; aiNotes: boolean }) {
  return (
    <Panel id="actions" title="Recent action items" aside={total > 0 ? <span className="chip tabular-nums">{total}</span> : undefined}>
      {items.length ? (
        <ul className="-mx-2 flex flex-col">
          {items.map((a, i) => (
            <li key={i}>
              <Link
                href={`/meetings/${a.meetingId}`}
                className="flex gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-sunken"
              >
                <Circle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-ink-4" />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-[14px] font-medium leading-snug">{a.task}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                    {[a.owner, a.due, `${formatShortDate(a.at, clock)} · ${a.meetingTitle}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex gap-3 rounded-2xl bg-sunken/70 p-4">
          <Sparkles aria-hidden className="mt-0.5 h-4 w-4 flex-none text-ink-3" />
          <p className="text-[14px] leading-relaxed text-ink-3">
            {aiNotes ? "When Mira writes notes for a meeting, the to-dos it finds show up here." : "Action items appear here when AI notes are turned on."}
          </p>
        </div>
      )}
    </Panel>
  );
}

function GroupedList({ rows, clock }: { rows: Row[]; clock: ClockT }) {
  const now = new Date();
  const groups: { label: string; items: MeetingCardData[] }[] = [];
  for (const m of rows) {
    const label = dayGroup(m.started_at, now, clock);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(toCard(m, clock));
    else groups.push({ label, items: [toCard(m, clock)] });
  }
  let index = 0;
  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="eyebrow mb-3 px-1">{g.label}</h3>
          <ul className="flex flex-col gap-2.5">
            {g.items.map((m) => (
              <MeetingCard key={m.id} m={m} index={index++} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NoResults({ q }: { q: string }) {
  return (
    <div className="animate-fade-up py-16 text-center">
      <p className="text-[19px] font-semibold">No meetings match “{q}”</p>
      <p className="mt-1 text-[15px] text-ink-3">Try a different word — search looks through titles and full transcripts.</p>
    </div>
  );
}

function EmptyState({ recording }: { recording: boolean }) {
  const steps = [
    { Icon: Mic, title: "Record", text: "Tap record at the start of a meeting." },
    { Icon: FileText, title: "Read along", text: "Every word appears as it’s spoken." },
    { Icon: Sparkles, title: "Get the notes", text: "A summary and action items, automatically." },
  ];
  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="flex flex-col items-center px-6 pb-10 pt-14 text-center">
        <div className="relative mb-8 grid h-24 w-24 place-items-center">
          <span aria-hidden className="ripple absolute inset-0 rounded-full bg-ink/10" />
          <span aria-hidden className="ripple ripple-delay absolute inset-0 rounded-full bg-ink/10" />
          <span className="relative grid h-20 w-20 place-items-center rounded-full bg-ink text-white shadow-[0_12px_30px_-10px_rgb(0_0_0/0.5)]">
            <Mic aria-hidden className="h-8 w-8" />
          </span>
        </div>
        <h2 className="text-[28px] font-semibold tracking-[-0.025em]">Record your first meeting</h2>
        <p className="mt-2 max-w-md text-[17px] text-ink-2">
          Mira writes down every word as people speak, then turns it into clear notes you can share.
        </p>
        {recording ? (
          <Link href="/record" className="btn btn-lg btn-primary mt-8">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-rec" />
            Start recording
          </Link>
        ) : (
          <p className="mt-8 rounded-full bg-sunken px-5 py-2.5 text-[15px] font-medium text-ink-2">
            Recording is paused right now — check back soon.
          </p>
        )}
      </div>
      <ol className="grid border-t border-line bg-sunken/60 sm:grid-cols-3">
        {steps.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex gap-3 border-line p-5 sm:flex-col sm:gap-2 sm:p-6 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-t-0">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-surface text-ink-2 shadow-[var(--shadow-card)]">
              <Icon aria-hidden className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold">
                {i + 1}. {title}
              </span>
              <span className="block text-[14px] text-ink-3">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HeadingSkeleton() {
  return (
    <div>
      <div className="skeleton h-3.5 w-36" />
      <div className="skeleton mt-3 h-9 w-72 max-w-full" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your meetings" className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-3.5 w-20" />
            <div className="skeleton h-7 w-16" />
            <div className="skeleton h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div className="card space-y-3 p-7">
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton h-7 w-3/5" />
            <div className="skeleton h-3.5 w-32" />
            <div className="skeleton mt-4 h-4 w-full" />
            <div className="skeleton h-4 w-4/5" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card flex items-center gap-5 p-5">
              <div className="skeleton h-12 w-12 rounded-2xl" />
              <div className="flex-1 space-y-2.5">
                <div className="skeleton h-4 w-2/5" />
                <div className="skeleton h-3.5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-5 lg:flex">
          <div className="skeleton h-52 rounded-[var(--radius-card)]" />
          <div className="skeleton h-64 rounded-[var(--radius-card)]" />
        </div>
      </div>
    </div>
  );
}
