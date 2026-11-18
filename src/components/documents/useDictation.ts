"use client";

import { useEffect, useRef, useState } from "react";
import { getDeepgramToken, MIME_CANDIDATES, openDeepgram } from "@/lib/deepgram-client";
import { createClient } from "@/lib/supabase/client";

export type DictationPhase = "idle" | "starting" | "listening" | "paused" | "polishing";

// Live dictation. Spoken "comma", "full stop", "new paragraph", "caps on"… are
// handled by lib/dictation (Deepgram's own dictation mode drops the capitals on
// names and mistakes words like "trial period" for commands).
const LIVE_URL =
  "wss://api.deepgram.com/v1/listen?" +
  new URLSearchParams({
    model: "nova-3",
    language: "en",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: "400",
  });

type Result = { type: string; is_final?: boolean; channel?: { alternatives?: { transcript: string }[] } };

/**
 * Microphone → live text (onText with each finished phrase, as heard) → when
 * stopped, the whole recording is transcribed again for accuracy (onPolished
 * with the full transcript, as heard). Pausing leaves the paused time out of
 * both. The audio is uploaded only for that second pass and deleted right after.
 */
export function useDictation({
  documentId,
  levelRef,
  onText,
  onPolished,
}: {
  documentId: string;
  /** Element that gets the live mic level as the CSS variable --level. */
  levelRef: React.RefObject<HTMLElement | null>;
  onText: (text: string) => void;
  /** The whole recording, as heard; null = keep the live text (polishing failed or found nothing). */
  /** `seconds`: time spent listening (pauses not counted). */
  onPolished: (text: string | null, note: string | undefined, seconds: number) => void;
}) {
  const [phase, setPhaseState] = useState<DictationPhase>("idle");
  // The phase right now (state lags a render; voice commands act mid-render).
  const phaseRef = useRef<DictationPhase>("idle");
  const setPhase = (p: DictationPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const supabase = useRef(createClient()).current;
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const timersRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const heardRef = useRef(false);
  const startedAtRef = useRef(0); // when listening last started or resumed
  const activeMsRef = useRef(0); // time spent listening before that
  const callbacks = useRef({ onText, onPolished });
  /** Seconds spent listening so far in this dictation (pauses not counted). */
  const spokenSeconds = () =>
    Math.round((activeMsRef.current + (phaseRef.current === "listening" ? Date.now() - startedAtRef.current : 0)) / 1000);
  useEffect(() => {
    callbacks.current = { onText, onPolished };
  });

  const release = () => {
    timersRef.current.forEach((t) => clearInterval(t));
    timersRef.current = [];
    cancelAnimationFrame(rafRef.current);
    levelRef.current?.style.setProperty("--level", "0");
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    wsRef.current = null;
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  };

  // Next.js hides the editor (rather than removing it) when you leave the
  // document, and shows the same one when you come back. Leaving mid-dictation
  // stops it cleanly: the words already typed stay, and the editor isn't left
  // stuck in "listening". (A clean-up that's already polishing finishes on its own.)
  const visibleRef = useRef(true);
  useEffect(() => {
    visibleRef.current = true;
    return () => {
      visibleRef.current = false;
      const p = phaseRef.current;
      if (p === "polishing") return;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.stop();
      }
      release();
      chunksRef.current = [];
      if (p === "listening" || p === "paused") {
        const secs = spokenSeconds();
        setInterim("");
        setPhase("idle");
        callbacks.current.onPolished(null, "Dictation stopped when you left the document. Everything up to that point is kept.", secs);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mic level → CSS variable --level (0–1) on the element given to levelRef. */
  const startMeter = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioCtxRef.current = ctx;
    const buf = new Uint8Array(analyser.fftSize);
    let smooth = 0;
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      if (phaseRef.current === "paused") {
        smooth = 0;
        levelRef.current?.style.setProperty("--level", "0");
        return;
      }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      smooth = smooth * 0.7 + level * 0.3;
      levelRef.current?.style.setProperty("--level", smooth.toFixed(3));
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /** Resolves false if dictation couldn't start (the error is in `error`). */
  const start = async (): Promise<boolean> => {
    if (phaseRef.current !== "idle") return false;
    setError(null);
    setInterim("");
    setSeconds(0);
    setPhase("starting");
    chunksRef.current = [];
    heardRef.current = false;
    const fail = (message: string) => {
      release();
      setError(message);
      setPhase("idle");
      return false;
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return fail("Mira needs your microphone. Allow access in your browser’s address bar, then try again.");
    }
    streamRef.current = stream;

    const { token, error: tokenError } = await getDeepgramToken();
    if (!token) return fail(tokenError ?? "Couldn’t start dictation.");
    let ws: WebSocket;
    try {
      ws = await openDeepgram(LIVE_URL, token);
    } catch {
      return fail("Couldn’t reach the transcription service. Check your internet connection and try again.");
    }
    wsRef.current = ws;
    if (!visibleRef.current) {
      // Left the document while dictation was starting.
      release();
      setPhase("idle");
      return false;
    }
    ws.onmessage = (event) => {
      let msg: Result;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (msg.type !== "Results") return;
      const text = msg.channel?.alternatives?.[0]?.transcript ?? "";
      if (msg.is_final) {
        setInterim("");
        if (text.trim()) {
          heardRef.current = true;
          callbacks.current.onText(text);
        }
      } else {
        setInterim(text);
      }
    };

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
    startedAtRef.current = Date.now();
    activeMsRef.current = 0;
    timersRef.current.push(
      window.setInterval(() => {
        if (phaseRef.current === "listening") setSeconds(Math.floor((activeMsRef.current + Date.now() - startedAtRef.current) / 1000));
      }, 500),
      window.setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "KeepAlive" }));
      }, 5000),
    );
    startMeter(stream);
    try {
      wakeRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      /* not supported */
    }
    setPhase("listening");
    return true;
  };

  /** The microphone stays open but nothing is heard or kept until resume(). */
  const pause = () => {
    const recorder = recorderRef.current;
    if (phaseRef.current !== "listening" || !recorder || recorder.state !== "recording") return;
    recorder.pause();
    activeMsRef.current += Date.now() - startedAtRef.current;
    setInterim("");
    setPhase("paused");
  };

  const resume = () => {
    const recorder = recorderRef.current;
    if (phaseRef.current !== "paused" || !recorder || recorder.state !== "paused") return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setPhase("listening");
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    const p = phaseRef.current;
    if ((p !== "listening" && p !== "paused") || !recorder) return;
    const secs = spokenSeconds();
    setPhase("polishing");

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    // Let the live service finish the last words before closing.
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        ws.addEventListener("close", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.send(JSON.stringify({ type: "CloseStream" }));
      });
    }
    release();
    setInterim("");

    if (!heardRef.current) {
      callbacks.current.onPolished(null, "Mira didn’t hear any words. Check your microphone and try again.", secs);
      setPhase("idle");
      return;
    }

    // Second pass over the whole recording.
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("signed out");
      const contentType = mimeRef.current.split(";")[0];
      const ext = contentType.includes("mp4") ? "m4a" : contentType.includes("ogg") ? "ogg" : "webm";
      const path = `${auth.user.id}/dictation/${documentId}-${Date.now()}.${ext}`;
      const blob = new Blob(chunksRef.current, { type: contentType });
      const { error: uploadError } = await supabase.storage.from("recordings").upload(path, blob, { contentType });
      if (uploadError) throw uploadError;
      const res = await fetch(`/api/documents/${documentId}/polish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const body = (await res.json().catch(() => ({}))) as { raw?: string };
      callbacks.current.onPolished(res.ok && body.raw?.trim() ? body.raw : null, undefined, secs);
    } catch {
      callbacks.current.onPolished(null, "Kept the live transcript — the accuracy pass couldn’t run this time.", secs);
    } finally {
      chunksRef.current = [];
      setPhase("idle");
    }
  };

  return { phase, interim, error, seconds, start, stop, pause, resume };
}
