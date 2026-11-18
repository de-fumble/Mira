"use client";

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { markTourSeen } from "@/app/tour-actions";
import type { TourId } from "@/lib/tour";
import { LogoMark } from "../Logo";

/* ------------------------------------------------------------------ */
/* What each tour says                                                  */
/* ------------------------------------------------------------------ */

/** One stop on a tour. `target` names a `data-tour` element to point at; without one the card sits mid-screen. */
type Step = { id: string; target?: string; title: string; body: ReactNode; next?: string; back?: string; welcome?: boolean };

type Options = { recording: boolean; aiNotes: boolean };

function homeSteps({ recording, aiNotes }: Options): Step[] {
  return [
    {
      id: "welcome",
      welcome: true,
      title: "Welcome to Mira",
      body: `Mira writes down your meetings as they happen${recording ? " and turns your voice into documents" : ""}. Here’s a quick look around — it takes about half a minute.`,
      next: "Show me around",
      back: "Not now",
    },
    {
      id: "record",
      target: "record",
      title: "Record a meeting",
      body: aiNotes
        ? "Start here when a meeting begins. Every word appears as people speak, and when you stop, Mira writes a summary and the to-dos."
        : "Start here when a meeting begins. Every word appears on screen as people speak.",
    },
    {
      id: "meetings",
      target: "meetings",
      title: "Your meetings",
      body: `Every recording is kept here with its full transcript${aiNotes ? ", notes and action items" : ""}.`,
    },
    { id: "search", target: "search", title: "Find anything", body: "Search looks through meeting titles and everything that was said." },
    {
      id: "documents",
      target: "documents",
      title: "Documents",
      body: recording
        ? "Talk instead of typing. Mira types what you say, checks the writing and gives you a Word or PDF file."
        : "Write letters and reports here. Mira checks the writing and gives you a Word or PDF file.",
    },
    { id: "account", target: "account", title: "Your account", body: "Your name, password and billing are here — and you can take this tour again any time." },
    {
      id: "done",
      title: "You’re all set",
      body: recording ? "Record your first meeting whenever you’re ready." : "Your meetings and documents will appear here as you use Mira.",
      next: "Done",
    },
  ];
}

const DOCUMENT_STEPS: Step[] = [
  {
    id: "dictate",
    target: "doc-dictate",
    title: "Dictate",
    body: "Press the microphone and talk — Mira types at your cursor. Say “comma” or “new paragraph” as you go; the full list of voice commands shows while you talk.",
    back: "Skip",
  },
  {
    id: "format",
    target: "doc-format",
    title: "Format",
    body: "Make a heading, bold a word or start a list: select the text, then pick a tool.",
  },
  {
    id: "review",
    target: "doc-review",
    title: "Check your writing",
    body: "When you’re done, Mira looks for misspelt words, sentences that don’t make sense and ones that don’t belong. Tap a flag to jump to it.",
  },
  { id: "download", target: "doc-download", title: "Download", body: "Get a Word document or PDF, formatting included, ready to send.", next: "Done" },
];

const tourFor = (path: string): TourId | null => (path === "/" ? "home" : /^\/documents\/[0-9a-f-]{36}$/i.test(path) ? "document" : null);

/* ------------------------------------------------------------------ */
/* Finding things on the page                                           */
/* ------------------------------------------------------------------ */

/** The visible element for a tour target (phones and computers each show their own copy of some controls). */
function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Whether the page is ready for this tour (loaded, no splash screen). */
function ready(id: TourId): boolean {
  if (document.querySelector("#splash[data-show]") && performance.now() < 1800) return false;
  if (document.querySelector("dialog[open]")) return false;
  if (id === "home") return !!findTarget("account") && !document.querySelector("[aria-busy=true]");
  return !!document.querySelector("#doc-body[contenteditable]") && !!findTarget("doc-format");
}

/** Ask for the tour of the current screen (the "Take the tour" menu item). */
export const TOUR_EVENT = "mira:tour";
export const requestTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

/* ------------------------------------------------------------------ */
/* Starting tours                                                       */
/* ------------------------------------------------------------------ */

/**
 * Starts each tour the first time someone reaches its screen: the home tour on
 * the meetings dashboard, the document tour in the document editor. Mounted
 * once in the app layout.
 */
export function TourHost({ seen, recording, aiNotes }: { seen: TourId[]; recording: boolean; aiNotes: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const tourId = tourFor(path);
  // Finished in this visit (the session token catches up on the next page load).
  const [done, setDone] = useState<TourId[]>([]);
  const [asked, setAsked] = useState<TourId | null>(null);
  const [running, setRunning] = useState<{ id: TourId; path: string; steps: Step[] } | null>(null);

  const due = tourId && !running && (asked === tourId || (!seen.includes(tourId) && !done.includes(tourId))) ? tourId : null;

  useEffect(() => {
    if (!due) return;
    const since = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - since > 20_000) return window.clearInterval(timer);
      if (!ready(due)) return;
      window.clearInterval(timer);
      const all = due === "home" ? homeSteps({ recording, aiNotes }) : DOCUMENT_STEPS;
      const steps = all.filter((s) => !s.target || findTarget(s.target));
      setAsked(null);
      if (steps.some((s) => s.target)) setRunning({ id: due, path, steps });
    }, 250);
    return () => window.clearInterval(timer);
  }, [due, path, recording, aiNotes]);

  useEffect(() => {
    const onAsk = () => {
      const here = tourFor(window.location.pathname);
      setRunning(null);
      setAsked(here ?? "home");
      if (!here) router.push("/");
    };
    window.addEventListener(TOUR_EVENT, onAsk);
    return () => window.removeEventListener(TOUR_EVENT, onAsk);
  }, [router]);

  // Leaving the screen (e.g. the browser's back button) ends its tour.
  if (!running || running.path !== path) return null;
  return (
    <Tour
      key={`${running.id}:${running.path}`}
      steps={running.steps}
      onClose={() => {
        setRunning(null);
        setDone((d) => [...d, running.id]);
        if (!seen.includes(running.id)) markTourSeen(running.id).catch(() => {});
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* The tour itself                                                      */
/* ------------------------------------------------------------------ */

type Rect = { x: number; y: number; w: number; h: number; r: number };
type Geo = { spot: Rect; top: number; left: number; width: number; animate: boolean };

const PAD = 6; // space around the highlighted control
const GAP = 14; // between the highlight and the card
const EDGE = 16; // from the screen edge

function measure(el: HTMLElement | null, cardH: number, animate: boolean): Geo {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = Math.min(380, vw - 2 * EDGE);
  if (!el) {
    return { spot: { x: vw / 2, y: vh / 2, w: 0, h: 0, r: 0 }, top: Math.max(EDGE, (vh - cardH) / 2), left: (vw - width) / 2, width, animate };
  }
  const b = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const spot = { x: b.left - PAD, y: b.top - PAD, w: b.width + 2 * PAD, h: b.height + 2 * PAD, r: Math.min(radius + PAD, (b.height + 2 * PAD) / 2) };
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - width - EDGE);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - cardH - EDGE);
  const roomBelow = vh - (spot.y + spot.h) - GAP - EDGE;
  const roomAbove = spot.y - GAP - EDGE;
  let top: number;
  let left = clampX(b.left + b.width / 2 - width / 2);
  if (roomBelow >= cardH) top = spot.y + spot.h + GAP;
  else if (roomAbove >= cardH) top = spot.y - GAP - cardH;
  else if (spot.x - GAP - EDGE >= width || vw - (spot.x + spot.w) - GAP - EDGE >= width) {
    // Tall panels on a wide screen: beside them.
    left = spot.x - GAP - EDGE >= width ? spot.x - GAP - width : spot.x + spot.w + GAP;
    top = clampY(spot.y + spot.h / 2 - cardH / 2);
  } else top = roomBelow >= roomAbove ? clampY(vh - cardH - EDGE) : EDGE;
  return { spot, top, left, width, animate };
}

const same = (a: Geo | null, b: Geo) =>
  !!a &&
  a.animate === b.animate &&
  Math.round(a.top) === Math.round(b.top) &&
  Math.round(a.left) === Math.round(b.left) &&
  a.width === b.width &&
  (["x", "y", "w", "h", "r"] as const).every((k) => Math.round(a.spot[k]) === Math.round(b.spot[k]));

/** Brings an off-screen target into view, just under the header. */
function reveal(el: HTMLElement | null) {
  if (!el) return;
  const b = el.getBoundingClientRect();
  const header = document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0;
  if (b.top >= header + PAD && b.bottom <= window.innerHeight - 96) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollBy({ top: b.top - header - 24, behavior: smooth ? "smooth" : "instant" });
}

function Tour({ steps, onClose }: { steps: Step[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [geo, setGeo] = useState<Geo | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const counted = steps.filter((s) => !s.welcome);

  // A modal dialog: the rest of the page can't be clicked or tabbed to while the tour is open.
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  // Each step: bring its control into view, then follow it (scrolling, resizing, the page settling).
  useEffect(() => {
    reveal(findTarget(step.target));
    primaryRef.current?.focus({ preventScroll: true });
    const moveUntil = performance.now() + 500;
    let frame = 0;
    const tick = () => {
      const next = measure(findTarget(step.target), cardRef.current?.offsetHeight ?? 220, performance.now() < moveUntil);
      setGeo((g) => (same(g, next) ? g : next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step]);

  const go = (to: number) => (to < 0 || to >= steps.length ? onClose() : setI(to));
  const glide = geo?.animate ? "transition-all duration-[400ms] ease-[var(--ease-out)] motion-reduce:transition-none" : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      onCancel={(e) => {
        e.preventDefault(); // Escape ends the tour our way
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(i + 1);
        else if (e.key === "ArrowLeft" && i > 0) go(i - 1);
      }}
      className="tour fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-ink"
    >
      {/* The dimmed screen with a window cut around the control being explained. */}
      <div
        aria-hidden
        className={`pointer-events-none fixed motion-safe:animate-fade-in ${glide}`}
        style={
          geo
            ? {
                left: geo.spot.x,
                top: geo.spot.y,
                width: geo.spot.w,
                height: geo.spot.h,
                borderRadius: geo.spot.r,
                boxShadow: `0 0 0 ${geo.spot.w ? 2 : 0}px rgb(255 255 255 / 0.85), 0 0 0 200vmax rgb(16 16 20 / 0.5)`,
              }
            : { inset: 0, background: "rgb(16 16 20 / 0.5)" }
        }
      />
      <div
        ref={cardRef}
        className={`fixed rounded-[22px] bg-surface p-5 shadow-[var(--shadow-pop)] motion-safe:animate-pop ${glide} ${geo ? "" : "invisible"}`}
        style={geo ? { top: geo.top, left: geo.left, width: geo.width } : { top: 0, left: 0, width: 360 }}
      >
        <div key={step.id} className="motion-safe:animate-fade-in" aria-live="polite">
          {step.welcome && <LogoMark className="mb-4 h-11 w-11" />}
          <div className="flex items-start justify-between gap-3">
            <h2 id="tour-title" className={`font-semibold tracking-[-0.02em] ${step.welcome ? "text-[22px]" : "text-[18px]"}`}>
              {step.title}
            </h2>
            {!step.welcome && !last && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close tour"
                className="tap -mr-2 -mt-1.5 grid h-9 w-9 flex-none place-items-center rounded-full text-ink-3 transition hover:bg-hover hover:text-ink"
              >
                <X aria-hidden className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
          <p id="tour-body" className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
            {step.body}
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          {step.welcome ? (
            <span />
          ) : (
            <span className="flex items-center gap-1.5" aria-label={`Step ${counted.indexOf(step) + 1} of ${counted.length}`} role="img">
              {counted.map((s) => (
                <span key={s.id} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? "w-4 bg-ink" : "w-1.5 bg-ink/15"}`} />
              ))}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            {(i > 0 || step.back) && (
              <button type="button" onClick={() => (step.back ? onClose() : go(i - 1))} className="btn btn-sm btn-ghost">
                {step.back ?? "Back"}
              </button>
            )}
            <button ref={primaryRef} type="button" onClick={() => go(i + 1)} className="btn btn-sm btn-primary min-w-20">
              {step.next ?? (last ? "Done" : "Next")}
            </button>
          </span>
        </div>
      </div>
    </dialog>
  );
}
