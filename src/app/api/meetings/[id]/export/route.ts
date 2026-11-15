import { NextResponse } from "next/server";
import { buildDocx, buildPdf, exportFilename, type ExportMeeting } from "@/lib/export";
import { createClient } from "@/lib/supabase/server";
import { formatTime, getClock } from "@/lib/time";
import type { MeetingSummary, Segment } from "@/lib/transcript";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** GET /api/meetings/:id/export?format=docx|pdf — the transcript (and notes) as a file. */
export async function GET(request: Request, ctx: RouteContext<"/api/meetings/[id]/export">) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "docx" && format !== "pdf") {
    return NextResponse.json({ error: "Choose format=docx or format=pdf." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  // Row Level Security means people can only export their own meetings.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("title, started_at, duration_seconds, transcript, summary")
    .eq("id", id)
    .maybeSingle<{ title: string; started_at: string; duration_seconds: number | null; transcript: Segment[] | null; summary: MeetingSummary | null }>();
  if (!meeting) return NextResponse.json({ error: "Meeting not found." }, { status: 404 });

  const clock = await getClock();
  const when = new Date(meeting.started_at);
  const date = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, ...o }).format(when);
  const data: ExportMeeting = {
    title: meeting.title,
    dateLine: `${date({ weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${formatTime(meeting.started_at, clock)}`,
    durationSeconds: meeting.duration_seconds,
    transcript: meeting.transcript ?? [],
    summary: meeting.summary,
  };

  const body = format === "docx" ? await buildDocx(data) : await buildPdf(data);
  const name = exportFilename(meeting.title, date({ day: "numeric", month: "short", year: "numeric" }), format);
  const ascii = name.replace(/[^\x20-\x7e]/g, "-").replace(/"/g, "'");

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
    },
  });
}
