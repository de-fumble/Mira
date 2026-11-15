"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock, speakerLabel, type Segment } from "@/lib/transcript";
import { SpeakerBadge, speakerText, Spinner } from "./ui";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

/**
 * Transcript with a docked audio player. Tap a line to play from there; the
 * line being spoken is highlighted and kept in view while playing.
 */
export function TranscriptPlayer({ audioUrl, segments }: { audioUrl: string | null; segments: Segment[] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [current, setCurrent] = useState(-1);

  const speakers = [...new Set(segments.map((s) => s.speaker))].sort((a, b) => a - b);

  const seek = useCallback((t: number, play = true) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, t);
    if (play) void el.play();
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  // Keep the spoken line in view while playing.
  useEffect(() => {
    if (playing && current >= 0) {
      lineRefs.current[current]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [current, playing]);

  // Space bar toggles playback (when not typing).
  useEffect(() => {
    if (!audioUrl) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === "Space" && !/input|textarea|button|select/i.test(t.tagName)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioUrl]);

  const onTime = () => {
    const t = audio.current?.currentTime ?? 0;
    setTime(t);
    setCurrent(segments.findIndex((s) => t >= s.start - 0.25 && t < s.end + 0.5));
  };

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <>
      {speakers.length > 1 && (
        <ul className="mb-6 flex flex-wrap gap-2" aria-label="Speakers">
          {speakers.map((s) => (
            <li key={s} className="chip !h-8 !pl-1">
              <SpeakerBadge speaker={s} size="sm" />
              {speakerLabel(s)}
            </li>
          ))}
        </ul>
      )}

      {segments.length > 0 ? (
        <ol className="-mx-3 flex flex-col">
          {segments.map((s, i) => {
            const prev = segments[i - 1];
            const newSpeaker = !prev || prev.speaker !== s.speaker;
            const active = i === current;
            return (
              <li
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className={`group relative rounded-2xl px-3 transition-colors duration-300 ${newSpeaker && i > 0 ? "mt-4" : ""} ${
                  active ? "bg-accent-soft" : audioUrl ? "hover:bg-sunken" : ""
                }`}
              >
                <button
                  type="button"
                  disabled={!audioUrl}
                  onClick={() => seek(s.start - 0.2)}
                  className="flex w-full gap-3.5 py-2.5 text-left disabled:cursor-text"
                  aria-label={audioUrl ? `Play from ${formatClock(s.start)}` : undefined}
                >
                  <span className="w-8 flex-none pt-0.5">{newSpeaker && <SpeakerBadge speaker={s.speaker} />}</span>
                  <span className="min-w-0 flex-1">
                    {newSpeaker && (
                      <span className="mb-0.5 flex items-baseline gap-2">
                        <span className={`text-[14px] font-semibold ${speakerText(s.speaker)}`}>{speakerLabel(s.speaker)}</span>
                        <span className="font-mono text-[12px] tabular-nums text-ink-4">{formatClock(s.start)}</span>
                      </span>
                    )}
                    <span className="block select-text text-[17px] leading-[1.6] text-ink">{s.text}</span>
                  </span>
                  {!newSpeaker && (
                    <span className="flex-none pt-1 font-mono text-[12px] tabular-nums text-ink-4 opacity-0 transition-opacity group-hover:opacity-100">
                      {formatClock(s.start)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[16px] text-ink-3">No speech was picked up in this recording.</p>
      )}

      {/* Docked player */}
      {audioUrl && (
        <>
          <audio
            ref={audio}
            src={audioUrl}
            preload="metadata"
            onTimeUpdate={onTime}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              // WebM from MediaRecorder often reports Infinity until fully read.
              if (Number.isFinite(d)) setDuration(d);
              else if (segments.length) setDuration(segments.at(-1)!.end);
            }}
            onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onEnded={() => setPlaying(false)}
          />
          <div className="px-safe bottom-safe pointer-events-none fixed inset-x-0 z-30 sm:bottom-6 sm:px-4">
            <div className="pointer-events-auto mx-auto flex max-w-2xl animate-fade-up items-center gap-2.5 rounded-full bg-surface/90 p-2 pr-2 shadow-[var(--shadow-pop)] backdrop-blur-xl backdrop-saturate-150 sm:gap-4 sm:pr-4">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="grid h-11 w-11 flex-none place-items-center rounded-full bg-ink text-white transition hover:bg-black active:scale-95"
              >
                {loading && playing ? (
                  <Spinner className="h-5 w-5" />
                ) : playing ? (
                  <Pause aria-hidden className="h-5 w-5" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play aria-hidden className="ml-0.5 h-5 w-5" fill="currentColor" strokeWidth={0} />
                )}
              </button>
              <span className="w-11 flex-none text-right font-mono text-[13px] tabular-nums text-ink-2 sm:w-12">{formatClock(time)}</span>
              <input
                type="range"
                className="scrubber min-w-0 flex-1"
                min={0}
                max={duration || 1}
                step={0.1}
                value={Math.min(time, duration || 1)}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setTime(t);
                  seek(t, false);
                }}
                style={{ "--p": `${pct}%` } as React.CSSProperties}
                aria-label="Seek"
                aria-valuetext={formatClock(time)}
              />
              <span className="hidden w-12 flex-none font-mono text-[13px] tabular-nums text-ink-3 sm:block">
                {formatClock(duration)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                  setSpeed(next);
                  if (audio.current) audio.current.playbackRate = next;
                }}
                className="tap group/speed grid h-11 w-[52px] flex-none place-items-center sm:h-8"
                aria-label={`Playback speed ${speed}×`}
              >
                <span className="grid h-8 w-12 place-items-center rounded-full bg-sunken text-[13px] font-semibold tabular-nums text-ink-2 transition group-hover/speed:bg-hover group-active/speed:bg-hover">
                  {speed}×
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
