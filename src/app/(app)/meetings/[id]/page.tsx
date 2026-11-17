import { Calendar, ChevronLeft, Clock, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EditableTitle } from "@/components/EditableTitle";
import { MeetingActions } from "@/components/MeetingActions";
import { NAV_BACK } from "@/components/PageTransition";
import { SummaryGenerator } from "@/components/SummaryGenerator";
import { TranscriptPlayer } from "@/components/TranscriptPlayer";
import { Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/features";
import { formatDate, formatTime, getClock } from "@/lib/time";
import { formatDuration, type MeetingStatus, type MeetingSummary, type Segment } from "@/lib/transcript";

export default function MeetingPage(props: PageProps<"/meetings/[id]">) {
  return (
    <>
      <Link
        href="/"
        transitionTypes={NAV_BACK}
        className="tap -ml-2 mb-3 inline-flex h-11 items-center gap-1 rounded-full pl-1.5 pr-3.5 text-[15px] font-medium text-ink-3 transition hover:bg-hover hover:text-ink active:bg-hover sm:mb-6 sm:h-9"
      >
        <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />
        Meetings
      </Link>
      <Suspense fallback={<MeetingSkeleton />}>
        <Meeting params={props.params} />
      </Suspense>
    </>
  );
}

/* Phones: plain sections on the page, divided by a hairline. Larger screens: cards. */
const SECTION =
  "max-sm:border-t max-sm:border-line max-sm:pt-7 sm:rounded-[var(--radius-card)] sm:bg-surface sm:p-8 sm:shadow-[var(--shadow-card)]";

type MeetingRow = {
  id: string;
  title: string;
  status: MeetingStatus;
  started_at: string;
  duration_seconds: number | null;
  audio_path: string | null;
  transcript: Segment[];
  transcript_text: string | null;
  summary: MeetingSummary | null;
};

async function Meeting({ params }: { params: PageProps<"/meetings/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [supabase, clock, features] = await Promise.all([createClient(), getClock(), getFeatures()]);
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, status, started_at, duration_seconds, audio_path, transcript, transcript_text, summary")
    .eq("id", id)
    .maybeSingle<MeetingRow>();

  if (!meeting) notFound();

  let audioUrl: string | null = null;
  if (meeting.audio_path) {
    const { data } = await supabase.storage.from("recordings").createSignedUrl(meeting.audio_path, 60 * 60 * 6);
    audioUrl = data?.signedUrl ?? null;
  }

  const hasTranscript = meeting.transcript.length > 0;
  const speakerCount = new Set(meeting.transcript.map((s) => s.speaker)).size;
  const s = meeting.summary;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <EditableTitle meetingId={meeting.id} initialTitle={meeting.title} />
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[15px] text-ink-3">
            <li className="inline-flex items-center gap-1.5">
              <Calendar aria-hidden className="h-4 w-4" />
              {formatDate(meeting.started_at, clock)}, {formatTime(meeting.started_at, clock)}
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Clock aria-hidden className="h-4 w-4" />
              {formatDuration(meeting.duration_seconds)}
            </li>
            {speakerCount > 0 && (
              <li className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="h-4 w-4" />
                {speakerCount} {speakerCount === 1 ? "speaker" : "speakers"}
              </li>
            )}
          </ul>
        </div>
        <MeetingActions meetingId={meeting.id} title={meeting.title} text={meeting.transcript_text ?? ""} />
      </header>

      {meeting.status === "recording" && (
        <Notice tone="warn" title="This recording didn’t finish saving">
          The page may have been closed while recording. Anything that was saved is shown below.
        </Notice>
      )}

      {/* Notes */}
      <section aria-labelledby="notes" className={SECTION}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id="notes" className="text-[20px] font-semibold tracking-tight">
            Notes
          </h2>
          {s && hasTranscript && features.ai_notes && <SummaryGenerator meetingId={meeting.id} variant="rewrite" />}
        </div>

        {s ? (
          <div className="flex animate-fade-in flex-col gap-8">
            <p className="text-[18px] leading-[1.65] text-ink">{s.summary}</p>

            {s.action_items.length > 0 && (
              <div>
                <h3 className="eyebrow mb-3">Action items</h3>
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl bg-sunken/70 max-sm:bg-surface max-sm:shadow-[0_0_0_1px_rgb(0_0_0/0.04)]">
                  {s.action_items.map((a, i) => (
                    <li key={i} className="flex gap-3.5 px-4 py-3.5">
                      <span aria-hidden className="mt-[3px] h-[18px] w-[18px] flex-none rounded-full border-[1.5px] border-ink-4" />
                      <span className="min-w-0">
                        <span className="block text-[16px] font-medium leading-snug">{a.task}</span>
                        {(a.owner || a.due) && (
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {a.owner && <span className="chip !h-6 bg-surface max-sm:bg-sunken">{a.owner}</span>}
                            {a.due && <span className="chip !h-6 bg-surface max-sm:bg-sunken">Due {a.due}</span>}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(s.decisions.length > 0 || s.key_points.length > 0) && (
              <div className="grid gap-8 md:grid-cols-2">
                {s.decisions.length > 0 && <BulletList title="Decisions" items={s.decisions} />}
                {s.key_points.length > 0 && <BulletList title="Key points" items={s.key_points} />}
              </div>
            )}
          </div>
        ) : hasTranscript && !features.ai_notes ? (
          <p className="text-[16px] text-ink-3">AI notes are turned off right now. The full transcript is below.</p>
        ) : hasTranscript ? (
          <SummaryGenerator meetingId={meeting.id} auto={meeting.status === "processing"} />
        ) : (
          <p className="text-[16px] text-ink-3">No speech was picked up, so there’s nothing to summarise.</p>
        )}
      </section>

      {/* Transcript */}
      <section aria-labelledby="transcript" className={SECTION}>
        <h2 id="transcript" className="mb-5 text-[20px] font-semibold tracking-tight">
          Transcript
        </h2>
        {!audioUrl && hasTranscript && (
          <p className="mb-5 text-[14px] text-ink-3">No audio was saved for this meeting.</p>
        )}
        <TranscriptPlayer audioUrl={audioUrl} segments={meeting.transcript} />
      </section>
    </article>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="eyebrow mb-3">{title}</h3>
      <ul className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-[16px] leading-relaxed text-ink-2">
            <span aria-hidden className="mt-[10px] h-1.5 w-1.5 flex-none rounded-full bg-ink-4" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MeetingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading meeting" className="flex flex-col gap-6">
      <div className="space-y-3">
        <div className="skeleton h-9 w-2/3 sm:w-1/2" />
        <div className="skeleton h-4 w-64" />
      </div>
      <div className={`space-y-3 ${SECTION}`}>
        <div className="skeleton mb-5 h-5 w-20" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-[90%]" />
        <div className="skeleton h-4 w-[70%]" />
      </div>
      <div className={`space-y-5 ${SECTION}`}>
        <div className="skeleton h-5 w-28" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3.5">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
