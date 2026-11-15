import "server-only";
import { GRACE_MS, type SubStatus } from "./billing-rules";
import { paystack, type PaystackAuthorization } from "./paystack";
import { createAdminClient } from "./supabase/admin";

export type Subscription = {
  user_id: string;
  status: SubStatus;
  access_until: string | null;
  trial_ends_at: string | null;
  had_trial: boolean;
  customer_code: string | null;
  subscription_code: string | null;
  email_token: string | null;
  authorization_code: string | null;
  card_signature: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp: string | null;
  last_reference: string | null;
  last_synced_at: string | null;
};

const table = () => createAdminClient().from("subscriptions");

/** The user's subscription row, or null. `missing` = the table hasn't been created yet. */
export async function getSubscription(userId: string): Promise<{ sub: Subscription | null; missing: boolean }> {
  const { data, error } = await table().select("*").eq("user_id", userId).maybeSingle<Subscription>();
  if (error) return { sub: null, missing: true };
  return { sub: data, missing: false };
}

export async function saveSubscription(row: Partial<Subscription> & { user_id: string }) {
  const { error } = await table().upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export function cardFields(a: PaystackAuthorization | null | undefined) {
  if (!a) return {};
  return {
    authorization_code: a.authorization_code,
    card_signature: a.signature,
    card_brand: a.brand ? a.brand.charAt(0).toUpperCase() + a.brand.slice(1) : a.card_type,
    card_last4: a.last4,
    card_exp: a.exp_month && a.exp_year ? `${a.exp_month.padStart(2, "0")}/${a.exp_year.slice(-2)}` : null,
  };
}

/**
 * Asks Paystack for the latest state of the subscription and stores it.
 * (Mira doesn't use a Paystack webhook, so this is how renewals, failed
 * payments and cancellations made on Paystack's own pages reach Mira.)
 */
export async function syncSubscription(sub: Subscription): Promise<Subscription> {
  if (!sub.subscription_code) return sub;
  const ps = await paystack.getSubscription(sub.subscription_code);
  const now = Date.now();
  const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : 0;
  const next = ps.next_payment_date ? new Date(ps.next_payment_date).getTime() : null;
  // The first real charge has gone through once the next payment is past the trial end.
  const paidSinceTrial = !trialEnd || (next !== null && next > trialEnd + GRACE_MS);

  let status: SubStatus = sub.status;
  let accessUntil = sub.access_until;
  switch (ps.status) {
    case "active":
      if (!paidSinceTrial) {
        status = "trialing";
        accessUntil = sub.trial_ends_at;
      } else {
        status = "active";
        if (next) accessUntil = new Date(next).toISOString();
      }
      break;
    case "non-renewing":
      status = "non_renewing";
      if (!paidSinceTrial) accessUntil = sub.trial_ends_at;
      break;
    case "attention":
      status = "attention";
      break;
    default: // "completed", "cancelled"
      status = accessUntil && new Date(accessUntil).getTime() > now ? "non_renewing" : "cancelled";
  }

  const updated: Subscription = {
    ...sub,
    ...cardFields(ps.authorization),
    status,
    access_until: accessUntil,
    email_token: ps.email_token ?? sub.email_token,
    last_synced_at: new Date().toISOString(),
  };
  await saveSubscription(updated);
  return updated;
}

/** Re-checks with Paystack when a renewal is due (or it's been 6 h). Never throws. */
export async function syncIfDue(userId: string) {
  try {
    const { sub } = await getSubscription(userId);
    if (!sub?.subscription_code) return;
    const due = sub.access_until && new Date(sub.access_until).getTime() < Date.now() + 60 * 60 * 1000;
    const stale = !sub.last_synced_at || Date.now() - new Date(sub.last_synced_at).getTime() > 6 * 60 * 60 * 1000;
    if (due || stale) await syncSubscription(sub);
  } catch {
    /* Paystack unreachable → try again next time */
  }
}

/** Is this card's free trial already used (by anyone)? */
export async function cardHadTrial(signature: string | null, exceptUser: string): Promise<boolean> {
  if (!signature) return false;
  const { data } = await table().select("user_id").eq("card_signature", signature).eq("had_trial", true).neq("user_id", exceptUser).limit(1);
  return Boolean(data?.length);
}
