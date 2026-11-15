import { NextResponse, type NextRequest } from "next/server";
import { cardFields, cardHadTrial, getSubscription, saveSubscription } from "@/lib/billing";
import { TRIAL_DAYS } from "@/lib/billing-rules";
import { PaystackError, paystack } from "@/lib/paystack";
import { createClient } from "@/lib/supabase/server";

/**
 * Paystack sends the browser here after checkout (?reference=…).
 * We verify the payment with Paystack ourselves, then create the subscription:
 *  - free trial: first ₦28,800 charge in 3 days; the ₦50 card check is refunded
 *  - paid: the first month was just charged; the next charge is in a month
 */
export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/billing?${q}`, request.url));
  const reference = request.nextUrl.searchParams.get("reference") ?? request.nextUrl.searchParams.get("trxref");
  if (!reference) return back("error=missing");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const plan = process.env.PAYSTACK_PLAN_CODE;
  if (!plan) return back("error=setup");

  let tx;
  try {
    tx = await paystack.verify(reference);
  } catch {
    return back("error=verify");
  }
  const meta = (typeof tx.metadata === "string" ? JSON.parse(tx.metadata || "{}") : tx.metadata ?? {}) as Record<string, unknown>;
  if (meta.user_id !== userId) return back("error=mismatch");
  if (tx.status !== "success") return back("error=declined");

  const { sub } = await getSubscription(userId);
  if (sub?.last_reference === reference) return back(`started=${sub.status === "trialing" ? "trial" : "paid"}`); // page refreshed

  const a = tx.authorization;
  const refund = () => paystack.refund(reference).catch(() => undefined);

  if (!a?.reusable) {
    await refund();
    return back("error=card");
  }

  const kind = meta.kind === "trial" ? "trial" : "paid";
  if (kind === "trial" && (sub?.had_trial || (await cardHadTrial(a.signature, userId)))) {
    // One free trial per person and per card.
    await refund();
    await saveSubscription({
      user_id: userId,
      status: sub?.status ?? "cancelled",
      access_until: sub?.access_until ?? null,
      had_trial: true,
      last_reference: reference,
    });
    return back("error=trial_used");
  }

  const start = new Date();
  if (kind === "trial") start.setDate(start.getDate() + TRIAL_DAYS);
  else start.setMonth(start.getMonth() + 1);

  let created: { subscription_code: string; email_token: string } | null = null;
  try {
    // Replace any old subscription (e.g. one whose payment failed) so nobody is charged twice.
    if (sub?.subscription_code && sub.email_token) {
      await paystack.disable(sub.subscription_code, sub.email_token).catch(() => undefined);
    }
    const ps = await paystack.createSubscription({
      customer: tx.customer.customer_code,
      plan,
      authorization: a.authorization_code,
      start_date: start.toISOString(),
    });
    created = ps;
    if (kind === "trial") await refund();

    await saveSubscription({
      user_id: userId,
      status: kind === "trial" ? "trialing" : "active",
      access_until: start.toISOString(),
      trial_ends_at: kind === "trial" ? start.toISOString() : (sub?.trial_ends_at ?? null),
      had_trial: Boolean(sub?.had_trial) || kind === "trial",
      customer_code: tx.customer.customer_code,
      subscription_code: ps.subscription_code,
      email_token: ps.email_token,
      ...cardFields(a),
      last_reference: reference,
      last_synced_at: new Date().toISOString(),
    });
    return back(`started=${kind}`);
  } catch (e) {
    // The card was charged but the subscription couldn't be set up: stop any
    // subscription Paystack created and give the money back.
    if (created) await paystack.disable(created.subscription_code, created.email_token).catch(() => undefined);
    await refund();
    return back(`error=${e instanceof PaystackError ? "paystack" : "save"}`);
  }
}
