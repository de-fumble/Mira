// Billing rules shared by the proxy and the server (no server-only imports).

export const PRICE_NAIRA = 28_800;
export const PRICE_KOBO = PRICE_NAIRA * 100;
export const TRIAL_DAYS = 3;
/** Small charge that proves the card works before the trial; refunded straight away. */
export const CARD_CHECK_KOBO = 50 * 100;
/** Paystack charges renewals during the due day, so keep access for a day while it does. */
export const GRACE_MS = 24 * 60 * 60 * 1000;

export type SubStatus = "trialing" | "active" | "non_renewing" | "attention" | "cancelled";

export function hasAccess(sub: { status: SubStatus; access_until: string | null } | null | undefined, now = Date.now()): boolean {
  if (!sub?.access_until) return false;
  if (sub.status === "attention" || sub.status === "cancelled") return false;
  return new Date(sub.access_until).getTime() + GRACE_MS > now;
}

/** Pages and APIs a signed-in person can use without a subscription. */
export function isBillingExempt(path: string): boolean {
  return (
    path.startsWith("/billing") ||
    path.startsWith("/settings") ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/maintenance") ||
    path === "/api/voice" ||
    path.startsWith("/admin") || // the admin pages do their own owner-only check
    path === "/api/health"
  );
}

export function formatNaira(n: number, locale = "en-NG"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "NGN", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
}
