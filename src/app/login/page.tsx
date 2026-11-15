import { FileText, Lock, Mic, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo, LogoMark } from "@/components/Logo";
import { getFeatures } from "@/lib/features";
import { LinkError, LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

const features = [
  { Icon: Mic, title: "Record in one tap", text: "Works in your browser — nothing to install." },
  { Icon: FileText, title: "Every word, as it’s said", text: "A live transcript that knows who’s speaking." },
  { Icon: Sparkles, title: "Notes that write themselves", text: "Summary, decisions and action items." },
  { Icon: Lock, title: "Private by default", text: "Only you can see your recordings." },
];

async function LoginWithSettings({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const [{ signups }, { mode }] = await Promise.all([getFeatures(), searchParams]);
  return <LoginForm signupsEnabled={signups} initialMode={mode === "signup" ? "up" : "in"} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid flex-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (large screens) */}
      <section className="relative hidden overflow-hidden bg-surface lg:flex lg:flex-col lg:justify-between lg:p-14 xl:p-16">
        <div className="relative">
          <Logo />
        </div>
        <div className="relative max-w-md">
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.04em] xl:text-[52px]">
            Every meeting.
            <br />
            <span className="text-ink-3">Every word.</span>
          </h1>
          <ul className="mt-10 flex flex-col gap-5">
            {features.map(({ Icon, title, text }, i) => (
              <li key={title} className="stagger flex gap-4" style={{ "--i": i + 2 } as React.CSSProperties}>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-sunken text-ink-2">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[16px] font-semibold">{title}</span>
                  <span className="block text-[15px] text-ink-3">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[13px] text-ink-4">© {"Mira"}</p>
      </section>

      {/* Form */}
      <section className="px-safe flex items-start justify-center pb-10 pt-[max(56px,calc(env(safe-area-inset-top)+32px))] sm:items-center sm:px-8 sm:py-14">
        <div className="w-full max-w-[400px] animate-page">
          <div className="mb-9 flex flex-col items-center text-center lg:items-start lg:text-left">
            <LogoMark className="h-12 w-12 lg:hidden" />
            <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.03em] lg:mt-0">Welcome to Mira</h2>
            <p className="mt-1.5 text-[16px] text-ink-3">Sign in to see your meetings.</p>
          </div>
          <Suspense>
            <LinkError />
          </Suspense>
          <Suspense fallback={<LoginForm />}>
            <LoginWithSettings searchParams={searchParams} />
          </Suspense>
          <p className="mt-8 text-center text-[14px] text-ink-3">
            New to Mira?{" "}
            <a href="/welcome" className="font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              See what it does
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
