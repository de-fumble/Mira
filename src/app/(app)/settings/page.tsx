import { AudioLines, CalendarDays, Clock, KeyRound, Mail, ShieldAlert, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { DeleteAccount, PasswordForm, UsernameForm } from "@/components/settings/SettingsForms";
import { getViewer } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { getClock } from "@/lib/time";
import { formatDuration } from "@/lib/transcript";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-7 sm:mb-10">
        <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">Settings</h1>
        <p className="mt-1 text-[16px] text-ink-3">Your profile, password and account.</p>
      </div>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

async function SettingsContent() {
  const [viewer, supabase, clock] = await Promise.all([getViewer(), createClient(), getClock()]);
  const [{ data: userData }, { data: rows }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("meetings").select("duration_seconds").returns<{ duration_seconds: number | null }[]>(),
  ]);
  const user = userData.user;
  const email = viewer.email ?? user?.email ?? "";
  const meetings = rows?.length ?? 0;
  const seconds = (rows ?? []).reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);
  const date = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)) : "—";

  return (
    <div className="flex flex-col gap-5">
      {/* Account summary */}
      <section aria-label="Your account" className="card animate-fade-up overflow-hidden">
        <div className="flex items-center gap-4 p-5 sm:p-6">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-ink text-[22px] font-semibold uppercase text-white">
            {(viewer.username || email).charAt(0) || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[19px] font-semibold tracking-tight">{viewer.username ?? "No username yet"}</p>
            <p className="flex items-center gap-1.5 truncate text-[15px] text-ink-3">
              <Mail aria-hidden className="h-4 w-4 flex-none" />
              <span className="truncate">{email}</span>
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 border-t border-line bg-sunken/60 text-[14px]">
          {[
            { Icon: CalendarDays, label: "Member since", value: date(user?.created_at) },
            { Icon: AudioLines, label: "Meetings", value: meetings.toLocaleString(clock.locale) },
            { Icon: Clock, label: "Recorded", value: seconds ? formatDuration(seconds) : "—" },
          ].map(({ Icon, label, value }, i) => (
            <div key={label} className={`min-w-0 px-4 py-4 sm:px-6 ${i ? "border-l border-line" : ""}`}>
              <dt className="flex items-center gap-1.5 text-[13px] text-ink-3">
                <Icon aria-hidden className="hidden h-3.5 w-3.5 sm:block" />
                {label}
              </dt>
              <dd className="mt-0.5 truncate font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section id="profile" Icon={UserRound} title="Profile" text="Choose the name Mira uses for you.">
        <UsernameForm current={viewer.username} />
      </Section>

      <Section id="password" Icon={KeyRound} title="Password" text="Enter your current password, then pick a new one.">
        <PasswordForm email={email} />
      </Section>

      <Section id="delete" Icon={ShieldAlert} title="Delete account" text="Permanently remove your account and everything in it." danger>
        <DeleteAccount email={email} meetings={meetings} isOwner={viewer.isAdmin} />
      </Section>
    </div>
  );
}

function Section({
  id,
  Icon,
  title,
  text,
  danger = false,
  children,
}: {
  id: string;
  Icon: typeof UserRound;
  title: string;
  text: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`card animate-fade-up grid gap-5 p-5 sm:p-6 md:grid-cols-[220px_1fr] md:gap-8 ${danger ? "ring-1 ring-danger/15" : ""}`}
    >
      <div className="flex gap-3 md:flex-col md:gap-3">
        <span
          className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${danger ? "bg-danger-soft text-danger" : "bg-sunken text-ink-2"}`}
        >
          <Icon aria-hidden className="h-5 w-5" />
        </span>
        <div>
          <h2 id={id} className={`text-[17px] font-semibold tracking-tight ${danger ? "text-danger" : ""}`}>
            {title}
          </h2>
          <p className="mt-0.5 text-[14px] leading-relaxed text-ink-3">{text}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" className="flex flex-col gap-5">
      <div className="card flex items-center gap-4 p-6">
        <div className="skeleton h-14 w-14 rounded-full" />
        <div className="flex-1 space-y-2.5">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-3.5 w-56" />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card grid gap-5 p-6 md:grid-cols-[220px_1fr] md:gap-8">
          <div className="space-y-2.5">
            <div className="skeleton h-10 w-10 rounded-xl" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-3.5 w-40" />
          </div>
          <div className="space-y-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-13 w-full rounded-[14px]" />
            <div className="skeleton h-11 w-36 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
