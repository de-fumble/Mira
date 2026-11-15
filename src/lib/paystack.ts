import "server-only";

/** Minimal Paystack REST client (https://paystack.com/docs/api). Amounts are in kobo. */

export class PaystackError extends Error {}

const BASE = "https://api.paystack.co";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaystackError("PAYSTACK_SECRET_KEY is not set.");
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !json?.status) throw new PaystackError(json?.message ?? `Paystack error ${res.status}`);
  return json.data as T;
}

export type PaystackAuthorization = {
  authorization_code: string;
  reusable: boolean;
  signature: string | null;
  brand: string | null;
  card_type: string | null;
  last4: string | null;
  exp_month: string | null;
  exp_year: string | null;
};

export type VerifiedTransaction = {
  id: number;
  reference: string;
  status: string; // "success" | "failed" | "abandoned" | …
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | string | null;
  authorization: PaystackAuthorization | null;
  customer: { id: number; customer_code: string; email: string };
};

export type PaystackSubscription = {
  subscription_code: string;
  email_token: string;
  status: string; // "active" | "non-renewing" | "attention" | "completed" | "cancelled"
  next_payment_date: string | null;
  authorization?: PaystackAuthorization | null;
};

export const paystack = {
  initialize: (p: {
    email: string;
    amount: number;
    reference: string;
    callback_url: string;
    metadata: Record<string, unknown>;
  }) =>
    call<{ authorization_url: string; reference: string }>("POST", "/transaction/initialize", {
      ...p,
      amount: String(p.amount),
      currency: "NGN",
      channels: ["card"], // subscriptions need a reusable card
    }),

  verify: (reference: string) => call<VerifiedTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`),

  refund: (reference: string) => call<unknown>("POST", "/refund", { transaction: reference }),

  createSubscription: (p: { customer: string; plan: string; authorization: string; start_date: string }) =>
    call<PaystackSubscription>("POST", "/subscription", p),

  getSubscription: (code: string) => call<PaystackSubscription>("GET", `/subscription/${encodeURIComponent(code)}`),

  disable: (code: string, token: string) => call<unknown>("POST", "/subscription/disable", { code, token }),

  enable: (code: string, token: string) => call<unknown>("POST", "/subscription/enable", { code, token }),

  manageLink: (code: string) => call<{ link: string }>("GET", `/subscription/${encodeURIComponent(code)}/manage/link`),
};
