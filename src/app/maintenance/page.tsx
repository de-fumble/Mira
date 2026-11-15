import type { Metadata } from "next";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = { title: "Back soon" };

export default function MaintenancePage() {
  return (
    <main className="px-safe flex flex-1 animate-page flex-col items-center justify-center py-24 text-center">
      <LogoMark className="h-14 w-14" />
      <h1 className="mt-7 text-[30px] font-semibold tracking-[-0.03em]">Mira will be back soon</h1>
      <p className="mt-3 max-w-sm text-[17px] leading-relaxed text-ink-2">
        We’re doing some quick maintenance. Your meetings and recordings are safe — please check back in a little while.
      </p>
    </main>
  );
}
