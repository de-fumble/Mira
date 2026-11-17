"use client";

import { ArrowDown, Check, Mic, Pause, Play, Square, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIME_CANDIDATES, openDeepgram } from "@/lib/deepgram-client";
import { createClient } from "@/lib/supabase/client";
import { appendWords, formatClock, speakerLabel, transcriptToText, type Segment } from "@/lib/transcript";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice, SpeakerBadge, speakerText, Spinner } from "./ui";

type Phase = "idle" | "starting" | "recording" | "paused" | "saving";
type SaveStep = 0 | 1 | 2 | 3; // finishing transcript → uploading → saving → done

// Deepgram live transcription. Audio is MediaRecorder webm/opus (a container
// format), so encoding/sample_rate are deliberately left out.
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?" +
  new URLSearchParams({
    model: "nova-3",
    language: "en",
    diarize_model: "latest",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: "300",
  });

type DeepgramResult = {
  type: string;
  is_final?: boolean;
  channel?: {
    alternatives?: {
      transcript: string;
      words?: { word: string; punctuated_word?: string; start: number; end: number; speaker?: number }[];
    }[];
  };
};

const now = () => Date.now();

/** The steps a recording goes through before it starts — each shown on screen and time-limited. */
type StartStep = "mic" | "account" | "transcription" | "meeting";
const START_LABEL: Record<StartStep, string> = {
  mic: "Opening your microphone…",
  account: "Checking your account…",
  transcription: "Connecting to live transcription…",
  meeting: "Starting the meeting…",
};

class StepTimeout extends Error {}

/** Rejects with StepTimeout if `promise` hasn't settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function defaultTitle() {
  const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(),
  );
  return `Meeting · ${when}`;
}

/**
 * aiNotes / saveAudio come from the admin feature switches: when audio saving
 * is off only the transcript is kept; when AI notes are off the meeting is
 * marked ready straight away.
 */
export function Recorder({ aiNotes = true, saveAudio = true }: { aiNotes?: boolean; saveAudio?: boolean }) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;

  const [phase, setPhase] = useState<Phase>("idle");
  const [startStep, setStartStep] = useState<StartStep>("mic");
  const [saveStep, setSaveStep] = useState<SaveStep>(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [canRetrySave, setCanRetrySave] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [following, setFollowing] = useState(true);
  /** A recording that was saved after you left this screen mid-recording. */
  const [savedWhileAway, setSavedWhileAway] = useState<string | null>(null);

  // Next.js keeps this screen alive (hidden) when you leave it and shows the
  // same instance when you come back — see the lifecycle effect below.
  const phaseRef = useRef<Phase>("idle");
  const visibleRef = useRef(true);
  const savedRef = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const segmentsRef = useRef<Segment[]>([]);
  const meetingRef = useRef<{ id: string; userId: string } | null>(null);
  const clockRef = useRef({ startedAt: 0, pausedAt: 0, pausedTotal: 0 });
  const durationRef = useRef(0);
  const closingRef = useRef(false);
  const intervalsRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const levelsRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const hiddenAtRef = useRef(0);
  const [screenAwake, setScreenAwake] = useState<"on" | "unavailable" | "off">("off");

  const live = phase === "recording" || phase === "paused";
  const busy = phase === "starting" || phase === "saving";

  /* ---------------- Phones: keep the screen awake ---------------- */
  // A sleeping phone can cut off the microphone, so ask the browser to keep
  // the screen on while recording (Wake Lock API, where supported).

  const requestWakeLock = async () => {
    try {
      if (!("wakeLock" in navigator)) throw new Error("unsupported");
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setScreenAwake("on");
    } catch {
      setScreenAwake("unavailable");
    }
  };

  const releaseWakeLock = () => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setScreenAwake("off");
  };

  // The browser drops the wake lock when the tab is hidden: take it again on
  // return, and tell the user if they were away long enough to lose audio.
  useEffect(() => {
    if (!live) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = now();
      } else {
        if (hiddenAtRef.current && now() - hiddenAtRef.current > 2000) {
          setWarning("Mira was in the background for a moment — some audio from that time may be missing.");
        }
        hiddenAtRef.current = 0;
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live]);

  const buzz = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  };

  /* ---------------- Waveform ---------------- */

  const draw = (active: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bar = 3;
    const gap = 3;
    const count = Math.floor(w / (bar + gap));
    const levels = levelsRef.current;
    ctx.fillStyle = active ? "#1d1d1f" : "#c7c7cc";
    for (let i = 0; i < count; i++) {
      const level = levels[levels.length - count + i] ?? 0;
      const bh = Math.max(3, Math.min(h, level * h));
      const x = i * (bar + gap);
      ctx.beginPath();
      ctx.roundRect(x, (h - bh) / 2, bar, bh, 1.5);
      ctx.fill();
    }
  };

  // Idle: a calm flat line.
  useEffect(() => {
    if (phase === "idle") {
      levelsRef.current = [];
      draw(false);
    }
  }, [phase]);

  const startMeter = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;
    const buf = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 55) {
        last = t;
        const recording = recorderRef.current?.state === "recording";
        let level = 0;
        if (recording) {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          level = Math.min(1, Math.sqrt(sum / buf.length) * 5.5);
          levelsRef.current.push(level);
          if (levelsRef.current.length > 400) levelsRef.current.splice(0, 100);
        }
        draw(recording);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /* ---------------- Lifecycle helpers ---------------- */

  /** Stops the mic, meter, timers and socket. Safe to call more than once. */
  const releaseMedia = () => {
    intervalsRef.current.forEach((id) => clearInterval(id));
    intervalsRef.current = [];
    cancelAnimationFrame(rafRef.current);
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    wsRef.current = null;
    releaseWakeLock();
  };

  // Warn before closing the tab mid-recording or while saving.
  useEffect(() => {
    if (!live && phase !== "saving") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [live, phase]);

  // Follow the newest words unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [segments, interim, following]);

  const elapsedNow = () => {
    const c = clockRef.current;
    const pausedNow = c.pausedAt ? now() - c.pausedAt : 0;
    return (now() - c.startedAt - c.pausedTotal - pausedNow) / 1000;
  };

  /* ---------------- Start ---------------- */

  const start = async () => {
    setSavedWhileAway(null);
    savedRef.current = false;
    setError(null);
    setWarning(null);
    setCanRetrySave(false);
    setSaveStep(0);
    setPhase("starting");
    segmentsRef.current = [];
    setSegments([]);
    setInterim("");
    setElapsed(0);
    setFollowing(true);
    chunksRef.current = [];
    closingRef.current = false;

    const fail = (message: string) => {
      releaseMedia();
      setError(message);
      setPhase("idle");
    };
    // Left the screen while it was still starting: let go of everything quietly.
    const left = () => {
      if (visibleRef.current) return false;
      releaseMedia();
      setPhase("idle");
      return true;
    };

    // Every step below is time-limited, so starting can never hang: if a step
    // stalls, the writer is told which one and can simply try again.

    // 1. Microphone (generous: the writer may be reading a permission prompt)
    setStartStep("mic");
    let stream: MediaStream;
    const mic = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      stream = await within(mic, 30_000);
    } catch (err) {
      if (err instanceof StepTimeout) {
        // If permission arrives after we gave up, switch the mic straight off again.
        void mic.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
        return fail("The microphone didn’t open. If your browser is asking for permission, tap Allow. If another app is using the microphone, close it. Then try again.");
      }
      return fail("Mira needs your microphone. Allow access in your browser’s address bar, then try again.");
    }
    streamRef.current = stream;
    if (left()) return;

    // 2. Signed-in user
    setStartStep("account");
    let userId: string;
    try {
      const { data: auth } = await within(supabase.auth.getUser(), 15_000);
      if (!auth.user) {
        releaseMedia();
        router.push("/login");
        return;
      }
      userId = auth.user.id;
    } catch {
      return fail("Couldn’t check your account — the connection is slow or offline. Please try again.");
    }

    // 3. Transcription connection: a short-lived pass from our server, then the live socket.
    setStartStep("transcription");
    let token: string;
    try {
      const tokenRes = await fetch("/api/deepgram/token", { method: "POST", signal: AbortSignal.timeout(15_000) });
      const tokenBody = (await tokenRes.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!tokenRes.ok || !tokenBody.token) {
        return fail(tokenBody.error ?? "Couldn’t start live transcription. Please try again.");
      }
      token = tokenBody.token;
    } catch {
      return fail("Live transcription didn’t respond in time. Please try again in a moment.");
    }
    let ws: WebSocket;
    try {
      ws = await openDeepgram(DEEPGRAM_URL, token);
    } catch {
      return fail("Couldn’t connect to live transcription. Check your internet connection and try again.");
    }
    wsRef.current = ws;
    if (left()) return;

    ws.onmessage = (event) => {
      let msg: DeepgramResult;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      if (!alt) return;
      if (msg.is_final) {
        if (alt.words?.length) {
          segmentsRef.current = appendWords(segmentsRef.current, alt.words);
          setSegments(segmentsRef.current);
        }
        setInterim("");
      } else {
        setInterim(alt.transcript);
      }
    };
    ws.onclose = () => {
      if (!closingRef.current) {
        setWarning("The live transcript connection dropped. Your audio is still being recorded.");
      }
    };

    // 4. Meeting record (Row Level Security fills in user_id)
    setStartStep("meeting");
    const { data: meeting, error: insertError } = await supabase
      .from("meetings")
      .insert({ title: defaultTitle() })
      .select("id")
      .abortSignal(AbortSignal.timeout(15_000))
      .single();
    if (insertError || !meeting) return fail("Couldn’t create the meeting — the connection is slow or offline. Please try again.");
    if (left()) {
      void supabase.from("meetings").delete().eq("id", meeting.id); // nothing was recorded
      return;
    }
    meetingRef.current = { id: meeting.id, userId };

    // 5. Record: each 250 ms chunk goes to Deepgram and into the saved file.
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    mimeRef.current = recorder.mimeType || mimeType || "audio/webm";
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunksRef.current.push(e.data);
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(e.data);
    };
    recorderRef.current = recorder;
    recorder.start(250);

    clockRef.current = { startedAt: now(), pausedAt: 0, pausedTotal: 0 };
    intervalsRef.current.push(
      window.setInterval(() => setElapsed(elapsedNow()), 250),
      // Keeps the connection open through pauses and silences.
      window.setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "KeepAlive" }));
      }, 5000),
    );
    startMeter(stream);
    void requestWakeLock();
    buzz(20);
    setPhase("recording");
  };

  /* ---------------- Pause / resume ---------------- */

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const c = clockRef.current;
    if (rec.state === "recording") {
      rec.pause();
      c.pausedAt = now();
      setPhase("paused");
    } else if (rec.state === "paused") {
      rec.resume();
      c.pausedTotal += now() - c.pausedAt;
      c.pausedAt = 0;
      setPhase("recording");
    }
  };

  /* ---------------- Stop & save ---------------- */

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    closingRef.current = true;
    buzz([15, 40, 15]);
    durationRef.current = Math.round(elapsedNow());
    setSaveStep(0);
    setPhase("saving");

    // The last chunk arrives (and is sent) before onstop fires.
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Let Deepgram finish the last words, then close.
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 6000);
        ws.addEventListener("close", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.send(JSON.stringify({ type: "CloseStream" }));
      });
    }
    releaseMedia();
    setInterim("");
    await save();
  };

  const save = async () => {
    const meeting = meetingRef.current;
    if (!meeting) return;
    setPhase("saving");
    setError(null);
    setCanRetrySave(false);

    // Upload audio (folder = user id, required by the storage policy).
    setSaveStep(1);
    const contentType = mimeRef.current.split(";")[0];
    const ext = contentType.includes("mp4") ? "m4a" : "webm";
    const audioPath = `${meeting.userId}/${meeting.id}.${ext}`;
    const blob = new Blob(chunksRef.current, { type: contentType });
    let uploaded = false;
    if (saveAudio) {
      const { error: uploadError } = await supabase.storage
        .from("recordings")
        .upload(audioPath, blob, { contentType, upsert: false });
      // "Duplicate" means a previous attempt already uploaded it — that's fine.
      uploaded = !uploadError || /exist|duplicate/i.test(uploadError.message);
    }

    setSaveStep(2);
    const transcript = segmentsRef.current;
    const transcriptText = transcriptToText(transcript);
    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        status: transcript.length && aiNotes ? "processing" : "ready",
        ended_at: new Date().toISOString(),
        duration_seconds: durationRef.current,
        audio_path: uploaded ? audioPath : null,
        transcript,
        transcript_text: transcriptText || null,
      })
      .eq("id", meeting.id);

    if (updateError) {
      setError("Couldn’t save the meeting. Check your connection and try again — nothing has been lost.");
      setCanRetrySave(true);
      return;
    }

    setSaveStep(3);
    savedRef.current = true;
    if (visibleRef.current) {
      router.push(`/meetings/${meeting.id}`);
    } else {
      // Saved after the writer left this screen: start fresh, with a link to it.
      reset();
      setSavedWhileAway(meeting.id);
    }
  };

  /** Back to a fresh, ready-to-record screen. */
  const reset = () => {
    meetingRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    segmentsRef.current = [];
    closingRef.current = false;
    savedRef.current = false;
    setSegments([]);
    setInterim("");
    setElapsed(0);
    setError(null);
    setWarning(null);
    setCanRetrySave(false);
    setSaveStep(0);
    setFollowing(true);
    setConfirmDiscard(false);
    setPhase("idle");
  };

  /* ---------------- Discard ---------------- */

  const discard = async () => {
    setDiscarding(true);
    closingRef.current = true;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    releaseMedia();
    if (meetingRef.current) await supabase.from("meetings").delete().eq("id", meetingRef.current.id);
    meetingRef.current = null;
    recorderRef.current = null;
    segmentsRef.current = [];
    setSegments([]);
    setInterim("");
    setElapsed(0);
    setWarning(null);
    setDiscarding(false);
    setConfirmDiscard(false);
    setPhase("idle");
  };

  /* ---------------- Leaving and coming back ---------------- */

  // Next.js doesn't remove this screen when you leave it: it hides it and
  // shows the same one when you come back. Leaving runs this cleanup; coming
  // back runs the setup again. So:
  //  - a meeting that finished saving → next visit starts fresh;
  //  - left mid-recording → stop and save it (nothing is lost), quietly;
  //  - left while starting or idle → let go of the microphone.
  useLayoutEffect(() => {
    visibleRef.current = true;
    return () => {
      visibleRef.current = false;
      const p = phaseRef.current;
      if (p === "recording" || p === "paused") void stop();
      else if (p === "saving") {
        if (savedRef.current) reset();
        // Still saving: it finishes on its own and resets itself (see save()).
      } else releaseMedia();
    };
    // Runs once per show/hide; the functions only use refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- UI ---------------- */

  const lastSpeaker = segments.at(-1)?.speaker ?? 0;
  const showTranscript = live || (phase === "saving" && segments.length > 0);

  // Phones while recording: compact header card, transcript in the middle,
  // controls docked at the bottom within thumb reach. (max-sm: = phones only)
  const dock = live;

  return (
    <div className={`flex flex-col gap-5 ${dock ? "max-sm:gap-3 max-sm:pb-28" : ""}`}>
      <section
        className={`card relative overflow-hidden px-6 pb-8 pt-7 sm:px-10 short:pb-5 short:pt-4 ${dock ? "max-sm:px-5 max-sm:pb-4 max-sm:pt-4" : ""}`}
      >
        {/* Status */}
        <div className="flex justify-center">
          <StatusPill phase={phase} />
        </div>

        {/* Timer */}
        <p
          className={`mt-5 text-center text-[60px] font-semibold short:mt-2 short:text-[44px] leading-none tracking-[-0.045em] tabular-nums transition-[color,font-size] sm:text-[80px] short:sm:text-[48px] ${
            phase === "paused" ? "text-ink-4" : "text-ink"
          } ${dock ? "max-sm:mt-3 max-sm:text-[44px]" : ""}`}
          aria-label={`Recording time ${formatClock(elapsed)}`}
        >
          {formatClock(elapsed)}
        </p>

        {/* Waveform */}
        <canvas
          ref={canvasRef}
          aria-hidden
          className={`mx-auto mt-6 block h-16 w-full max-w-md short:mt-3 short:h-10 ${dock ? "max-sm:mt-3 max-sm:h-10" : ""}`}
        />

        {dock && screenAwake === "unavailable" && (
          <p className="mt-3 text-center text-[13px] text-ink-3 sm:hidden">Keep this screen on while recording.</p>
        )}

        {/* Controls (docked to the bottom of the screen on phones while recording) */}
        <div
          className={`mt-7 flex min-h-[104px] items-center justify-center short:mt-3 short:min-h-[84px] ${
            dock
              ? "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:mt-0 max-sm:min-h-0 max-sm:border-t max-sm:border-line max-sm:bg-surface/90 max-sm:pb-[max(14px,env(safe-area-inset-bottom))] max-sm:pt-3.5 max-sm:backdrop-blur-xl max-sm:backdrop-saturate-150"
              : ""
          }`}
        >
          {phase === "saving" ? (
            <SaveProgress step={saveStep} error={canRetrySave} saveAudio={saveAudio} />
          ) : live ? (
            <div className="flex animate-fade-in items-center gap-8">
              <RoundButton label="Discard recording" onClick={() => setConfirmDiscard(true)}>
                <Trash aria-hidden className="h-5 w-5" />
              </RoundButton>
              <button
                type="button"
                onClick={stop}
                aria-label="Stop and save"
                className="group grid h-[76px] w-[76px] place-items-center rounded-full bg-rec text-white shadow-[0_14px_32px_-12px_rgb(229_55_43/0.7)] transition hover:scale-[1.04] active:scale-95 sm:h-[88px] sm:w-[88px]"
              >
                <Square aria-hidden className="h-7 w-7" fill="currentColor" strokeWidth={0} />
              </button>
              <RoundButton label={phase === "paused" ? "Resume" : "Pause"} onClick={togglePause}>
                {phase === "paused" ? (
                  <Play aria-hidden className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Pause aria-hidden className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                )}
              </RoundButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={busy}
              aria-label="Start recording"
              className="relative grid h-[96px] w-[96px] place-items-center rounded-full bg-ink short:h-20 short:w-20 text-white shadow-[0_16px_36px_-12px_rgb(0_0_0/0.55)] transition hover:scale-[1.04] active:scale-95 disabled:hover:scale-100"
            >
              {phase === "idle" && (
                <>
                  <span aria-hidden className="ripple absolute inset-0 rounded-full bg-ink/15" />
                  <span aria-hidden className="ripple ripple-delay absolute inset-0 rounded-full bg-ink/15" />
                </>
              )}
              {busy ? (
                <Spinner className="h-8 w-8" />
              ) : (
                <span aria-hidden className="relative h-8 w-8 rounded-full bg-rec ring-[3px] ring-white" />
              )}
            </button>
          )}
        </div>

        <p className={`mt-4 text-center text-[15px] text-ink-3 ${dock ? "max-sm:hidden" : ""}`} aria-live="polite">
          {phase === "idle" && "Tap to start recording"}
          {phase === "starting" && START_LABEL[startStep]}
          {phase === "recording" && "Recording — tap the red button when you’re done"}
          {phase === "paused" && "Paused — nothing is being recorded"}
          {phase === "saving" && " "}
        </p>

        {(error || (warning && live)) && (
          <div className={`mx-auto mt-6 max-w-lg ${dock ? "max-sm:mt-3" : ""}`}>
            {error ? (
              <Notice
                tone="error"
                title={canRetrySave ? "Not saved yet" : "Couldn’t start recording"}
                action={
                  canRetrySave && (
                    <button type="button" onClick={save} className="btn btn-sm btn-primary">
                      Try saving again
                    </button>
                  )
                }
              >
                {error}
              </Notice>
            ) : (
              <Notice tone="warn">{warning}</Notice>
            )}
          </div>
        )}

        {phase === "idle" && !error && savedWhileAway && (
          <div className={`mx-auto mt-6 max-w-lg ${dock ? "max-sm:mt-3" : ""}`}>
            <Notice
              tone="success"
              title="Your last recording was saved"
              action={
                <Link href={`/meetings/${savedWhileAway}`} className="btn btn-sm btn-secondary">
                  Open it
                </Link>
              }
            >
              You left this screen while recording, so Mira stopped and saved it for you.
            </Notice>
          </div>
        )}
      </section>

      {phase === "idle" && !error && (
        <p className="flex animate-fade-in items-center justify-center gap-2 text-center text-[14px] text-ink-3">
          <Mic aria-hidden className="h-4 w-4" />
          Let everyone know the meeting is being recorded.
        </p>
      )}

      {/* Live transcript */}
      {showTranscript && (
        <section aria-labelledby="live" className="card relative animate-fade-up">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5 sm:px-8 sm:py-4">
            <h2 id="live" className="text-[17px] font-semibold tracking-tight">
              Live transcript
            </h2>
            {segments.length > 0 && (
              <span className="text-[13px] text-ink-3">
                {new Set(segments.map((s) => s.speaker)).size} speaking
              </span>
            )}
          </div>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
            }}
            className={`max-h-[52dvh] min-h-40 overflow-y-auto overscroll-contain px-5 py-4 sm:px-8 sm:py-5 ${
              // Phone height budget: header + timer card + transcript title + dock ≈ 29rem.
              dock ? "max-sm:h-[calc(100dvh-29rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-sm:max-h-none max-sm:min-h-[10rem]" : ""
            }`}
            aria-live="polite"
          >
            {segments.length === 0 && !interim ? (
              <p className="flex items-center gap-2 text-[18px] text-ink-4">
                <span className="caret">Listening</span>
              </p>
            ) : (
              <ol className="flex flex-col gap-5">
                {segments.map((s, i) => (
                  <li key={i} className="flex animate-fade-up gap-3">
                    <SpeakerBadge speaker={s.speaker} />
                    <div className="min-w-0">
                      <p className={`text-[14px] font-semibold ${speakerText(s.speaker)}`}>{speakerLabel(s.speaker)}</p>
                      <p className="text-[19px] leading-[1.5] tracking-[-0.01em] sm:text-[22px]">{s.text}</p>
                    </div>
                  </li>
                ))}
                {interim && (
                  <li className="flex gap-3">
                    <span className="w-8 flex-none">{segments.length === 0 && <SpeakerBadge speaker={lastSpeaker} />}</span>
                    <p className="caret text-[19px] leading-[1.5] tracking-[-0.01em] text-ink-3 sm:text-[22px]">{interim}</p>
                  </li>
                )}
              </ol>
            )}
          </div>
          {!following && (
            <button
              type="button"
              onClick={() => setFollowing(true)}
              className="btn btn-sm btn-primary absolute bottom-4 left-1/2 -translate-x-1/2 animate-pop"
            >
              <ArrowDown aria-hidden className="h-4 w-4" />
              Latest
            </button>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this recording?"
        confirmLabel="Discard"
        pending={discarding}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
      >
        The audio and transcript so far will be thrown away. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

function StatusPill({ phase }: { phase: Phase }) {
  const map: Record<Phase, { text: string; className: string; dot?: string }> = {
    idle: { text: "Ready", className: "bg-sunken text-ink-2" },
    starting: { text: "Getting ready", className: "bg-sunken text-ink-2" },
    recording: { text: "Recording", className: "bg-rec-soft text-rec", dot: "rec-dot bg-rec" },
    paused: { text: "Paused", className: "bg-warn-soft text-warn", dot: "bg-warn" },
    saving: { text: "Saving", className: "bg-accent-soft text-accent" },
  };
  const s = map[phase];
  return (
    <span
      key={phase}
      className={`inline-flex h-8 animate-pop items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold ${s.className}`}
    >
      {s.dot && <span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} />}
      {s.text}
    </span>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-14 w-14 place-items-center rounded-full bg-sunken text-ink-2 transition hover:bg-hover hover:text-ink active:scale-95"
    >
      {children}
    </button>
  );
}

function SaveProgress({ step, error, saveAudio }: { step: SaveStep; error: boolean; saveAudio: boolean }) {
  const steps = ["Finishing the transcript", saveAudio ? "Uploading the audio" : "Keeping the transcript only", "Saving your meeting"];
  return (
    <ol className="flex w-full max-w-xs animate-fade-in flex-col gap-3" aria-label="Saving progress">
      {steps.map((label, i) => {
        const done = step > i;
        const activeStep = step === i;
        return (
          <li
            key={label}
            className={`flex items-center gap-3 text-[15px] transition-colors ${
              done ? "text-ink" : activeStep ? "font-medium text-ink" : "text-ink-4"
            }`}
          >
            <span className="grid h-6 w-6 flex-none place-items-center">
              {done ? (
                <span className="grid h-5 w-5 animate-pop place-items-center rounded-full bg-ink text-white">
                  <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : activeStep && !error ? (
                <Spinner className="h-5 w-5 text-accent" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-ink-4/50" />
              )}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
