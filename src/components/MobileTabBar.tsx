"use client";

import { AudioLines, FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_FORWARD, NAV_TAB } from "./PageTransition";

const TABS = [
  { href: "/", label: "Meetings", Icon: AudioLines, match: (p: string) => p === "/" },
  { href: "/documents", label: "Documents", Icon: FileText, match: (p: string) => p === "/documents" },
] as const;

/** Screens that have their own bottom controls (or are full-screen) hide the tab bar. */
const hiddenOn = (p: string) => p === "/record" || p.startsWith("/meetings/") || /^\/documents\/[^/]+/.test(p);

const tick = () => {
  // A tiny tap of feedback where supported (Android).
  try {
    navigator.vibrate?.(6);
  } catch {}
};

/**
 * Phone navigation, like a native app: Meetings · Record · Documents, within
 * thumb reach. The tapped tab lights up immediately, before the screen loads.
 */
export function MobileTabBar({ recording }: { recording: boolean }) {
  const path = usePathname();
  // Which tab was just tapped, and from which screen (cleared by navigating).
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  if (hiddenOn(path)) return null;
  const active = tapped && tapped.from === path ? tapped.href : TABS.find((t) => t.match(path))?.href;

  const tab = (t: (typeof TABS)[number]) => {
    const on = active === t.href;
    return (
      <Link
        key={t.href}
        href={t.href}
        transitionTypes={NAV_TAB}
        aria-current={on ? "page" : undefined}
        onClick={() => {
          if (!on) tick();
          setTapped({ href: t.href, from: path });
        }}
        className={`flex flex-col items-center justify-center gap-[3px] pt-1 text-[11px] font-medium tracking-[0.01em] transition-colors duration-200 ${
          on ? "text-ink" : "text-ink-4 active:text-ink-3"
        }`}
      >
        <t.Icon aria-hidden className="h-[23px] w-[23px]" strokeWidth={on ? 2.2 : 1.8} />
        {t.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      style={{ viewTransitionName: "tab-bar" }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-[1.8] sm:hidden"
    >
      <div className={`mx-auto grid h-[58px] max-w-md items-stretch ${recording ? "grid-cols-3" : "grid-cols-2"}`}>
        {tab(TABS[0])}
        {recording && (
          <div className="grid place-items-center">
            <Link
              href="/record"
              transitionTypes={NAV_FORWARD}
              aria-label="New recording"
              onClick={tick}
              className="grid h-[46px] w-[46px] place-items-center rounded-full bg-ink shadow-[0_6px_16px_-6px_rgb(0_0_0/0.5)] transition-transform duration-200 ease-[var(--ease-out)] active:scale-90"
            >
              <span aria-hidden className="h-[15px] w-[15px] rounded-full bg-rec ring-[2.5px] ring-white/90" />
            </Link>
          </div>
        )}
        {tab(TABS[1])}
      </div>
    </nav>
  );
}
