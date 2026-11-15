import { ArrowRight, AudioLines, Check, CreditCard, Lock, RotateCcw, Search, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { manageCard, refreshStatus, resumeSubscription, startCheckout } from "@/app/billing-actions";
import { ActionButton, CancelButton } from "@/components/billing/BillingButtons";
import { Notice } from "@/components/ui";
import { getViewer } from "@/lib/admin";
import { getSubscription, syncSubscription, type Subscription } from "@/lib/billing";
import { PRICE_NAIRA, TRIAL_DAYS, formatNaira, hasAccess } from "@/lib/billing-rules";
import { getFeatures } from "@/lib/features";
import { getClock, type Clock } from "@/lib/time";

export const metadata: Metadata = { title: "Billing" };

const PERKS = [
  { Icon: AudioLines, text: "Unlimited recordings with live transcription" },
  { Icon: Users, text: "Knows who’s speaking in every meeting" },
  { Icon: Sparkles, text: "AI notes: summary, decisions and action items" },
  { Icon: Search, text: "Search every word of every meeting" },
];

export default function BillingPage(props: PageProps<"/billing">) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-7 sm:mb-10">
        <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">Billing</h1>
        <p className="mt-1 text-[16px] text-ink-3">Your Mira Pro plan and payment card.</p>
      </div>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading billing" className="skeleton h-96 rounded-[var(--radius-card)]" />}>
        <Billing searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

const ERRORS: Record<string, string> = {
  declined: "The payment didn’t go through. Please try again or use another card.",
  card: "That card can’t be used for monthly payments. Please try a debit or credit card.",
  trial_used: "This card or account has already had a free trial. Subscribe below to keep using Mira.",
  verify: "We couldn’t confirm the payment with Paystack. If you were charged, it will be refunded.",
  paystack: "Paystack couldn’t set up the subscription. Any charge has been refunded — please try again.",
  save: "Something went wrong saving your subscription. Any charge has been refunded — please try again.",
  mismatch: "That payment belongs to a different account.",
  missing: "We didn’t get a payment reference back from Paystack.",
  setup: "Billing isn’t fully set up yet. Please try again later.",
};

/** Dates and countdowns (kept out of render so the clock is read once). */
function describe(sub: Subscription | null, clock: Clock) {
  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(clock.locale, { timeZone: clock.timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)) : "—";
  const now = Date.now();
  const trialStartIfNew = new Date(now + TRIAL_DAYS * 86_400_000).toISOString();
  const daysLeft = sub?.access_until ? Math.max(0, Math.ceil((new Date(sub.access_until).getTime() - now) / 86_400_000)) : 0;
  return { fmt, daysLeft, firstChargeIfNew: fmt(trialStartIfNew), access: hasAccess(sub, now) };
}

async function Billing({ searchParams }: { searchParams: PageProps<"/billing">["searchParams"] }) {
  const [params, viewer, features, clock] = await Promise.all([searchParams, getViewer(), getFeatures(), getClock()]);
  const { sub: stored, missing } = await getSubscription(viewer.id!);

  // Always show the latest from Paystack here (renewals, failed payments, card changes).
  let sub = stored;
  let syncFailed = false;
  if (sub?.subscription_code) {
    try {
      sub = await syncSubscription(sub);
    } catch {
      syncFailed = true;
    }
  }

  const { fmt, daysLeft, firstChargeIfNew, access } = describe(sub, clock);
  const price = formatNaira(PRICE_NAIRA, clock.locale.startsWith("en") ? "en-NG" : clock.locale);
  const started = typeof params.started === "string" ? params.started : null;
  const error = typeof params.error === "string" ? (ERRORS[params.error] ?? "Something went wrong. Please try again.") : null;

  if (missing) {
    return (
      <Notice tone="warn" title="Billing isn’t set up yet">
        {viewer.isAdmin ? "Run supabase/migrations/0003_subscriptions.sql in the Supabase SQL Editor to turn on subscriptions." : "Please check back soon."}
      </Notice>
    );
  }

  if (!features.billing) {
    return (
      <Notice tone="success" title="Mira is free right now">
        No subscription is needed at the moment. Enjoy!
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      {started && access && (
        <Notice
          tone="success"
          title={started === "trial" ? `Your ${TRIAL_DAYS}-day free trial has started` : "You’re subscribed to Mira Pro"}
          action={
            <Link href="/" className="btn btn-sm btn-primary">
              Start using Mira
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        >
          {started === "trial"
            ? `The ₦50 card check has been refunded. Your first payment of ${price} is on ${fmt(sub?.trial_ends_at ?? null)}.`
            : `Thanks! Your next payment is on ${fmt(sub?.access_until ?? null)}.`}
        </Notice>
      )}
      {viewer.isAdmin && (
        <Notice tone="info" title="You’re the owner">
          Mira is always free for your account. This page shows what your users see.
        </Notice>
      )}

      {sub && sub.subscription_code && sub.status !== "cancelled" ? (
        <StatusCard sub={sub} fmt={fmt} daysLeft={daysLeft} price={price} syncFailed={syncFailed} />
      ) : (
        <PlanCard trial={!sub?.had_trial} price={price} firstCharge={firstChargeIfNew} />
      )}
    </div>
  );
}

function PlanCard({ trial, price, firstCharge }: { trial: boolean; price: string; firstCharge: string }) {
  return (
    <section aria-labelledby="plan" className="card animate-fade-up overflow-hidden">
      <div className="grid md:grid-cols-[1fr_300px]">
        <div className="p-6 sm:p-8">
          <p className="eyebrow">Mira Pro</p>
          <h2 id="plan" className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[32px]">
            {trial ? `Try Mira free for ${TRIAL_DAYS} days` : "Subscribe to keep using Mira"}
          </h2>
          <p className="mt-2 max-w-md text-[16px] leading-relaxed text-ink-2">
            {trial
              ? `Add a card to start. You won’t pay anything until ${firstCharge}, and you can cancel any time before then.`
              : "Pick up right where you left off. Your meetings are all still here."}
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {PERKS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[15px]">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-sunken text-ink-2">
                  <Icon aria-hidden className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col border-t border-line bg-sunken/60 p-6 sm:p-8 md:border-l md:border-t-0">
          <p className="flex items-baseline gap-1.5">
            <span className="text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{price}</span>
            <span className="text-[15px] text-ink-3">/ month</span>
          </p>
          <p className="mt-2 text-[14px] text-ink-3">{trial ? `after your ${TRIAL_DAYS}-day free trial` : "billed monthly · cancel any time"}</p>
          <ul className="mt-5 flex flex-col gap-2 text-[14px] text-ink-2">
            {(trial
              ? [`Free until ${firstCharge}`, "Cancel in one click", "Your meetings stay yours"]
              : [`${price} today, then monthly`, "Cancel in one click", "Keep all your meetings"]
            ).map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check aria-hidden className="h-4 w-4 flex-none text-success" />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-6 md:mt-auto md:pt-6">
            <ActionButton action={startCheckout} pendingLabel="Opening Paystack…" className="btn btn-lg btn-primary w-full">
              <CreditCard aria-hidden className="h-5 w-5" />
              {trial ? "Add card & start trial" : `Subscribe · ${price}`}
            </ActionButton>
            <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-3">
              <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
              {trial
                ? "Secure checkout by Paystack. We charge ₦50 to check your card and refund it straight away."
                : "Secure checkout by Paystack. Mira never sees your card number."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const BADGES = {
  trialing: { label: "Free trial", cls: "bg-accent-soft text-accent" },
  active: { label: "Active", cls: "bg-success-soft text-success" },
  non_renewing: { label: "Cancelled", cls: "bg-sunken text-ink-2" },
  attention: { label: "Payment failed", cls: "bg-danger-soft text-danger" },
  cancelled: { label: "Ended", cls: "bg-sunken text-ink-2" },
} as const;

function StatusCard({
  sub,
  fmt,
  daysLeft,
  price,
  syncFailed,
}: {
  sub: Subscription;
  fmt: (iso: string | null) => string;
  daysLeft: number;
  price: string;
  syncFailed: boolean;
}) {
  const badge = BADGES[sub.status];
  const until = fmt(sub.access_until);
  const headline = {
    trialing: daysLeft <= 1 ? "Your free trial ends today" : `${daysLeft} days left in your free trial`,
    active: "Mira Pro is active",
    non_renewing: `You can use Mira until ${until}`,
    attention: "We couldn’t take your payment",
    cancelled: "Your subscription has ended",
  }[sub.status];
  const detail = {
    trialing: `Your first payment of ${price} is on ${until}. Cancel before then and you won’t be charged.`,
    active: `Your next payment of ${price} is on ${until}.`,
    non_renewing: "You won’t be charged again. Resume any time before then to keep going.",
    attention: "Update your card so Paystack can try again. Mira is paused until the payment goes through.",
    cancelled: "",
  }[sub.status];

  return (
    <>
      <section aria-labelledby="status" className="card animate-fade-up overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="eyebrow">Mira Pro · {price}/month</p>
            <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-semibold ${badge.cls}`}>{badge.label}</span>
          </div>
          <h2 id="status" className="mt-3 text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-[30px]">
            {headline}
          </h2>
          <p className="mt-2 max-w-lg text-[16px] leading-relaxed text-ink-2">{detail}</p>

          {sub.status === "trialing" && (
            <div className="mt-6 max-w-md">
              <div className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${Math.min(100, Math.max(6, ((TRIAL_DAYS - daysLeft) / TRIAL_DAYS) * 100))}%` }}
                />
              </div>
              <p className="mt-2 text-[13px] text-ink-3">
                Day {Math.min(TRIAL_DAYS, TRIAL_DAYS - daysLeft + 1)} of {TRIAL_DAYS}
              </p>
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-start gap-3">
            {sub.status === "non_renewing" && (
              <ActionButton action={resumeSubscription} pendingLabel="Resuming…">
                Resume subscription
              </ActionButton>
            )}
            {sub.status === "attention" && (
              <ActionButton action={manageCard} pendingLabel="Opening Paystack…">
                <CreditCard aria-hidden className="h-4 w-4" />
                Update card
              </ActionButton>
            )}
            {(sub.status === "trialing" || sub.status === "active") && (
              <Link href="/" className="btn btn-md btn-primary">
                Go to my meetings
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Card on file */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-sunken/60 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-14 place-items-center rounded-lg bg-surface text-[11px] font-bold uppercase tracking-wide text-ink-2 shadow-[var(--shadow-card)]">
              {sub.card_brand?.slice(0, 4) ?? <CreditCard aria-hidden className="h-4 w-4" />}
            </span>
            <span>
              <span className="block text-[15px] font-semibold">
                {sub.card_brand ?? "Card"} •••• {sub.card_last4 ?? "····"}
              </span>
              <span className="block text-[13px] text-ink-3">{sub.card_exp ? `Expires ${sub.card_exp}` : "Card on file"}</span>
            </span>
          </div>
          {sub.status !== "attention" && (
            <ActionButton action={manageCard} pendingLabel="Opening…" className="btn btn-sm btn-secondary">
              Update card
            </ActionButton>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <ActionButton action={refreshStatus} pendingLabel="Checking…" className="btn btn-sm btn-ghost">
          <RotateCcw aria-hidden className="h-4 w-4" />
          Refresh status
        </ActionButton>
        {(sub.status === "trialing" || sub.status === "active") && <CancelButton trial={sub.status === "trialing"} until={until} />}
      </div>
      {syncFailed && (
        <p className="px-1 text-[13px] text-ink-3">Couldn’t reach Paystack just now, so this may be a few minutes out of date.</p>
      )}
    </>
  );
}
