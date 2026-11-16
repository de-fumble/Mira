"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Spinner } from "../ui";

const TABS: { href: string; label: string; short?: string }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/correction", label: "Correction engine", short: "Engine" },
  { href: "/admin/features", label: "Features" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="inline-flex rounded-full bg-sunken p-1">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`tap grid h-10 place-items-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition sm:h-9 ${
              active ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.short ? (
              <>
                <span className="sm:hidden">{t.short}</span>
                <span className="max-sm:hidden">{t.label}</span>
              </>
            ) : (
              t.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Re-checks every service and number on the page. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="btn btn-sm btn-secondary"
    >
      {pending ? <Spinner /> : <RotateCcw aria-hidden className="h-4 w-4" />}
      {pending ? "Checking…" : "Refresh"}
    </button>
  );
}
