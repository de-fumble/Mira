"use client";

import { useSyncExternalStore } from "react";
import type { DocAnalysis } from "@/lib/documents";
import type { ReviewEvent, ReviewPlace } from "@/lib/review/events";

/*
 * Runs AI reviews in the browser, one per document, outside any component —
 * so a review keeps going (and keeps retrying) while the writer moves around
 * the app. If the AI is busy or slow, the server keeps the review's place and
 * says when to ask again; this waits and asks, as long as it takes. A dropped
 * connection is treated the same way. The writer is only ever told it's
 * taking longer than usual.
 */

export type ReviewRun =
  | { phase: "idle" }
  /** `waiting`: paused where it got to, carrying on shortly. `since`: when the review started. */
  | { phase: "running"; place: ReviewPlace | null; waiting: boolean; since: number }
  | { phase: "done"; analysis: DocAnalysis }
  /** Something the writer can fix (signed out, document too long…). */
  | { phase: "error"; message: string };

const IDLE: ReviewRun = { phase: "idle" };
const runs = new Map<string, ReviewRun>();
const listeners = new Map<string, Set<() => void>>();
const active = new Set<string>();

const set = (id: string, run: ReviewRun) => {
  runs.set(id, run);
  listeners.get(id)?.forEach((fn) => fn());
};

export function useReviewRun(id: string): ReviewRun {
  return useSyncExternalStore(
    (fn) => {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    () => runs.get(id) ?? IDLE,
    () => IDLE,
  );
}

/** Every document whose review finished, as it happens. */
const finished = new Set<(id: string) => void>();
export function onReviewFinished(fn: (id: string) => void) {
  finished.add(fn);
  return () => void finished.delete(fn);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits `ms`, and while the device is offline, until it's back online. */
async function pause(ms: number) {
  await sleep(ms);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
  }
}

type Outcome = { kind: "done"; analysis: DocAnalysis } | { kind: "wait"; ms: number } | { kind: "error"; message: string };

/** One request to the analyze endpoint, read to the end. */
async function attempt(id: string, query: string, onPlace: (place: ReviewPlace, waiting: boolean) => void): Promise<Outcome> {
  const res = await fetch(`/api/documents/${id}/analyze${query}`, { method: "POST" });
  if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("ndjson")) {
    // Problems the writer can fix come back with a message; anything else (a server
    // hiccup, a gateway timeout) is just a reason to try again.
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status >= 400 && res.status < 500 && body.error) return { kind: "error", message: body.error };
    return { kind: "wait", ms: 15_000 };
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let about: string | undefined;
  let last: Outcome = { kind: "wait", ms: 10_000 }; // if the stream just stops
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      let e: ReviewEvent;
      try {
        e = JSON.parse(line) as ReviewEvent;
      } catch {
        continue;
      }
      if (e.type === "done") return { kind: "done", analysis: e.analysis };
      if (e.type === "error") return { kind: "error", message: e.error };
      if (e.type === "waiting") {
        about = e.about ?? about;
        onPlace({ stage: e.stage, done: e.done, total: e.total, about }, true);
        last = { kind: "wait", ms: e.retryInMs };
      } else {
        if (e.stage === "understand" && e.detail) about = e.detail;
        onPlace({ stage: e.stage, done: e.done, total: e.total, about }, false);
        last = { kind: "wait", ms: 10_000 };
      }
    }
    if (done) return last;
  }
}

/**
 * Starts (or, with `resume`, carries on) the review of a document; does
 * nothing if one is already running here. `known`: when the review the page
 * shows was made (so a review that finished elsewhere is recognised).
 */
export function startReview(id: string, opts: { resume?: boolean; known?: string | null; place?: ReviewPlace | null; since?: number } = {}) {
  if (active.has(id)) return;
  active.add(id);
  const since = opts.since ?? Date.now();
  let place = opts.place ?? null;
  let waiting = !!opts.resume;
  set(id, { phase: "running", place, waiting, since });
  void (async () => {
    let resume = !!opts.resume;
    let dropped = 0;
    try {
      for (;;) {
        const query = resume ? `?${new URLSearchParams({ resume: "1", known: opts.known ?? "" })}` : "";
        let outcome: Outcome;
        try {
          outcome = await attempt(id, query, (p, w) => {
            place = p;
            waiting = w;
            set(id, { phase: "running", place, waiting, since });
          });
          dropped = 0;
        } catch {
          // Offline or the connection dropped: try again, less often the longer it lasts.
          outcome = { kind: "wait", ms: Math.min(60_000, 5_000 * 2 ** dropped++) };
        }
        if (outcome.kind === "done") {
          set(id, { phase: "done", analysis: outcome.analysis });
          finished.forEach((fn) => fn(id));
          return;
        }
        if (outcome.kind === "error") {
          set(id, { phase: "error", message: outcome.message });
          return;
        }
        resume = true;
        waiting = true;
        set(id, { phase: "running", place, waiting, since });
        await pause(outcome.ms);
      }
    } finally {
      active.delete(id);
    }
  })();
}
