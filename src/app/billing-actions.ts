"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/admin";
import { getSubscription, syncSubscription } from "@/lib/billing";
import { CARD_CHECK_KOBO, PRICE_KOBO, hasAccess } from "@/lib/billing-rules";
import { paystack } from "@/lib/paystack";

export type BillingResult = { error?: string } | undefined;

async function origin() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (h.get("host")?.startsWith("localhost") ? "http" : "https");
  return h.get("origin") ?? `${proto}://${h.get("host")}`;
}

/** Sends the user to Paystack: a ₦50 card check for the free trial, or the first month's payment. */
export async function startCheckout(): Promise<BillingResult> {
  const viewer = await getViewer();
  if (!viewer.id || !viewer.email) redirect("/login");
  const { sub, missing } = await getSubscription(viewer.id);
  if (missing) return { error: "Billing isn’t set up yet. Please try again later." };
  if (hasAccess(sub)) redirect("/billing");

  const trial = !sub?.had_trial;
  let url: string;
  try {
    const { authorization_url } = await paystack.initialize({
      email: viewer.email,
      amount: trial ? CARD_CHECK_KOBO : PRICE_KOBO,
      reference: `mira_${trial ? "trial" : "sub"}_${randomUUID().replaceAll("-", "")}`,
      callback_url: `${await origin()}/billing/callback`,
      metadata: {
        user_id: viewer.id,
        kind: trial ? "trial" : "paid",
        custom_fields: [{ display_name: "Purpose", variable_name: "purpose", value: trial ? "Mira Pro free trial (card check, refunded)" : "Mira Pro, first month" }],
      },
    });
    url = authorization_url;
  } catch {
    return { error: "Couldn’t reach Paystack. Please try again in a moment." };
  }
  redirect(url);
}

async function ownSubscription() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/login");
  const { sub } = await getSubscription(viewer.id);
  return sub;
}

/** Stops future charges. Access continues until the end of the trial or paid month. */
export async function cancelSubscription(): Promise<BillingResult> {
  const sub = await ownSubscription();
  if (!sub?.subscription_code || !sub.email_token) return { error: "There’s no subscription to cancel." };
  try {
    await paystack.disable(sub.subscription_code, sub.email_token);
    await syncSubscription(sub);
  } catch {
    return { error: "Couldn’t cancel right now. Please try again in a moment." };
  }
  refresh();
}

/** Turns renewals back on after cancelling (while access hasn't run out). */
export async function resumeSubscription(): Promise<BillingResult> {
  const sub = await ownSubscription();
  if (!sub?.subscription_code || !sub.email_token) return { error: "There’s no subscription to resume." };
  try {
    await paystack.enable(sub.subscription_code, sub.email_token);
    await syncSubscription(sub);
  } catch {
    return { error: "Couldn’t resume this subscription. Start a new one below instead." };
  }
  refresh();
}

/** Opens Paystack's secure page for changing the card. */
export async function manageCard(): Promise<BillingResult> {
  const sub = await ownSubscription();
  if (!sub?.subscription_code) return { error: "There’s no subscription yet." };
  let link: string;
  try {
    link = (await paystack.manageLink(sub.subscription_code)).link;
  } catch {
    return { error: "Couldn’t open Paystack. Please try again in a moment." };
  }
  redirect(link);
}

/** Re-checks the subscription with Paystack (the "Refresh status" button). */
export async function refreshStatus(): Promise<BillingResult> {
  const sub = await ownSubscription();
  if (sub?.subscription_code) {
    try {
      await syncSubscription(sub);
    } catch {
      return { error: "Couldn’t reach Paystack. Please try again in a moment." };
    }
  }
  refresh();
}
