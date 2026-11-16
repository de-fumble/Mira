"use client";

import { CreditCard, Gauge, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { signOut } from "@/app/actions";
import { Logo } from "./Logo";
import { Spinner } from "./ui";

/** Header record button — desktop/tablet only; phones get MobileRecordButton. */
export function RecordLink() {
  return (
    <Link href="/record" className="btn btn-md btn-primary max-sm:hidden">
      <span aria-hidden className="h-2 w-2 rounded-full bg-rec" />
      New recording
    </Link>
  );
}

/** Record button in the header — hidden while you're already on /record.
 *  Render inside <Suspense fallback={<RecordLink />}> (it reads the URL). */
export function HeaderRecordButton() {
  const path = usePathname();
  return path === "/record" ? null : <RecordLink />;
}

/** Floating, thumb-reachable Record button for phones. */
export function MobileRecordButton() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-safe z-30 flex justify-center sm:hidden">
      <Link
        href="/record"
        className="btn pointer-events-auto h-14 animate-fade-up gap-2.5 bg-ink px-7 text-[17px] text-white shadow-[0_10px_30px_-8px_rgb(0_0_0/0.55)] active:scale-95"
      >
        <span aria-hidden className="h-3 w-3 rounded-full bg-rec ring-2 ring-white/90" />
        Record
      </Link>
    </div>
  );
}

export function HeaderBrand() {
  return (
    <Link href="/" aria-label="Mira — all meetings" className="rounded-full transition-opacity hover:opacity-75">
      <Logo />
    </Link>
  );
}

const NAV = [
  { href: "/", label: "Meetings", match: (p: string) => p === "/" || p.startsWith("/meetings") || p === "/record" },
  { href: "/documents", label: "Documents", match: (p: string) => p.startsWith("/documents") },
] as const;

function NavLinks({ path }: { path: string | null }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 rounded-full bg-sunken p-1">
      {NAV.map((item) => {
        const on = path !== null && item.match(path);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`tap rounded-full px-3 py-1.5 text-[14px] font-medium transition sm:px-3.5 ${
              on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Meetings / Documents switcher. Render inside <Suspense fallback={<AppNavFallback />}>. */
export function AppNav() {
  return <NavLinks path={usePathname()} />;
}

export function AppNavFallback() {
  return <NavLinks path={null} />;
}

const menuItem =
  "tap flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] font-medium text-ink-2 transition hover:bg-sunken hover:text-ink active:bg-sunken sm:h-10 sm:text-[14px]";

/** Avatar button with a small menu (name, settings, admin, sign out). */
export function UserMenu({ email, name, isAdmin = false }: { email: string; name?: string | null; isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="tap grid h-11 w-11 place-items-center rounded-full bg-sunken text-[15px] font-semibold uppercase text-ink-2 transition hover:bg-hover active:scale-95 sm:h-10 sm:w-10"
      >
        {(name || email).charAt(0) || "?"}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[52px] z-30 w-[min(17rem,calc(100vw-32px))] origin-top-right animate-pop rounded-2xl bg-surface p-1.5 shadow-[var(--shadow-pop)]"
        >
          <div className="px-3 pb-2 pt-2.5">
            {name ? (
              <>
                <p className="truncate text-[15px] font-semibold">{name}</p>
                <p className="truncate text-[13px] text-ink-3">{email}</p>
              </>
            ) : (
              <>
                <p className="text-[12px] font-medium text-ink-3">Signed in as</p>
                <p className="truncate text-[14px] font-medium">{email}</p>
              </>
            )}
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className={menuItem}>
            <Settings aria-hidden className="h-4 w-4" />
            Settings
          </Link>
          <Link role="menuitem" href="/billing" onClick={() => setOpen(false)} className={menuItem}>
            <CreditCard aria-hidden className="h-4 w-4" />
            Billing
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className={menuItem}>
              <Gauge aria-hidden className="h-4 w-4" />
              Admin dashboard
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => signOut())}
            className={menuItem}
          >
            {pending ? <Spinner /> : <LogOut aria-hidden className="h-4 w-4" />}
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
