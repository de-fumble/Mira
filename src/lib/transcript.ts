// Shared transcript types and helpers (used in browser and server code).

/** One stretch of speech by one speaker. Matches meetings.transcript (jsonb). */
export type Segment = {
  speaker: number; // 0-based, from Deepgram diarization
  start: number; // seconds from the start of the recording
  end: number;
  text: string;
};

/** Shape stored in meetings.summary (jsonb). Mirrors the zod schema in summarize.ts. */
export type MeetingSummary = {
  title: string;
  summary: string;
  key_points: string[];
  decisions: string[];
  action_items: { task: string; owner: string | null; due: string | null }[];
};

export type MeetingStatus = "recording" | "processing" | "ready" | "failed";

/** Longest meeting title a user can set. */
export const TITLE_MAX = 120;

export function speakerLabel(speaker: number): string {
  return `Speaker ${speaker + 1}`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds) return "—";
  const m = Math.round(totalSeconds / 60);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Plain-text transcript, one line per segment: "[00:12] Speaker 1: Hello". */
export function transcriptToText(segments: Segment[]): string {
  return segments
    .map((s) => `[${formatClock(s.start)}] ${speakerLabel(s.speaker)}: ${s.text}`)
    .join("\n");
}

type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number;
};

/**
 * Appends the words of one final Deepgram result to the running list of
 * segments, starting a new segment whenever the speaker changes or there is
 * a long pause. Returns a new array (safe for React state).
 */
export function appendWords(segments: Segment[], words: DeepgramWord[]): Segment[] {
  const next = segments.slice();
  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const text = w.punctuated_word ?? w.word;
    const last = next[next.length - 1];
    if (last && last.speaker === speaker && w.start - last.end < 4) {
      next[next.length - 1] = { ...last, end: w.end, text: `${last.text} ${text}` };
    } else {
      next.push({ speaker, start: w.start, end: w.end, text });
    }
  }
  return next;
}
