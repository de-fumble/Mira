import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "./supabase/admin";
import { PRICE_NAIRA, hasAccess, type SubStatus } from "./billing-rules";
import { dailyCounts, type Clock } from "./time";

export type ServiceState = "ok" | "down" | "off";
export type Service = { name: string; state: ServiceState; detail: string; ms?: number };

const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
};

/* ---------------------------------------------------------------- Deepgram */

export type DeepgramStatus = {
  service: Service;
  balanceUsd: number | null;
  lowBalanceUsd: number;
  monthHours: number;
  monthRequests: number;
};

const DG = "https://api.deepgram.com/v1";

export async function getDeepgramStatus(): Promise<DeepgramStatus> {
  const lowBalanceUsd = Number(process.env.DEEPGRAM_LOW_BALANCE_USD ?? 20) || 20;
  const empty = { balanceUsd: null, lowBalanceUsd, monthHours: 0, monthRequests: 0 };
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { ...empty, service: { name: "Live transcription", state: "off", detail: "DEEPGRAM_API_KEY not set" } };

  const get = async (path: string) => {
    const res = await fetch(DG + path, { headers: { Authorization: `Token ${key}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Deepgram ${res.status}`);
    return res.json();
  };

  try {
    const { value, ms } = await timed(async () => {
      const { projects } = (await get("/projects")) as { projects: { project_id: string }[] };
      const id = projects[0]?.project_id;
      if (!id) throw new Error("No Deepgram project");
      const today = new Date();
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const [balances, usage] = await Promise.all([
        get(`/projects/${id}/balances`) as Promise<{ balances: { amount: number; units: string }[] }>,
        get(`/projects/${id}/usage?start=${fmt(first)}&end=${fmt(today)}`) as Promise<{
          results: { hours: number; requests: number }[];
        }>,
      ]);
      const usd = balances.balances.filter((b) => b.units.toLowerCase() === "usd");
      return {
        balanceUsd: usd.length ? usd.reduce((s, b) => s + b.amount, 0) : null,
        monthHours: usage.results.reduce((s, r) => s + (r.hours ?? 0), 0),
        monthRequests: usage.results.reduce((s, r) => s + (r.requests ?? 0), 0),
      };
    });
    return {
      ...value,
      lowBalanceUsd,
      service: { name: "Live transcription", state: "ok", detail: "Deepgram connected", ms },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unreachable";
    return {
      ...empty,
      service: { name: "Live transcription", state: "down", detail: /401|403/.test(msg) ? "Key rejected" : msg },
    };
  }
}

/* -------------------------------------------------------------- Claude API */

export async function getClaudeStatus(): Promise<Service> {
  const name = "AI notes";
  if (!process.env.ANTHROPIC_API_KEY) return { name, state: "off", detail: "ANTHROPIC_API_KEY not set" };
  try {
    // Reading model info is free and confirms the key works.
    const { ms } = await timed(() => new Anthropic().models.retrieve("claude-opus-5-5"));
    return { name, state: "ok", detail: "Claude connected", ms };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { name, state: "down", detail: "Key rejected" };
    if (e instanceof Anthropic.APIError) return { name, state: "down", detail: `Claude API error ${e.status ?? ""}`.trim() };
    return { name, state: "down", detail: "Unreachable" };
  }
}

/* -------------------------------------------------- Database, users, usage */

type MeetingRow = {
  id: string;
  user_id: string;
  status: "recording" | "processing" | "ready" | "failed";
  started_at: string;
  duration_seconds: number | null;
  audio_path: string | null;
  summary: string | null; // summary->>summary
};

export type UsageStats = {
  database: Service;
  storage: Service;
  users: { total: number; newThisWeek: number };
  meetings: { total: number; hours: number; thisWeek: number; lastWeek: number; avgMinutes: number };
  daily: { date: string; label: string; short: string; count: number }[];
  attention: { unfinished: number; stuckNotes: number };
  recent: { id: string; email: string; startedAt: string; duration: number | null; status: MeetingRow["status"]; audio: boolean; notes: boolean }[];
};

export async function getUsageStats(clock: Clock): Promise<UsageStats> {
  const admin = createAdminClient();
  const now = Date.now();
  const DAY = 86_400_000;

  const [meetingsRes, usersRes, storageRes] = await Promise.all([
    timed(async () =>
      admin
        .from("meetings")
        .select("id, user_id, status, started_at, duration_seconds, audio_path, summary->>summary")
        .order("started_at", { ascending: false })
        .limit(5000)
        .returns<MeetingRow[]>(),
    ),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    timed(async () => {
      // Recordings live in one folder per user: add up the file sizes.
      const bucket = admin.storage.from("recordings");
      const { data: folders, error } = await bucket.list("", { limit: 1000 });
      if (error) throw error;
      const sizes = await Promise.all(
        (folders ?? []).map(async (f) => {
          const { data: files } = await bucket.list(f.name, { limit: 1000 });
          return (files ?? []).reduce((s, x) => s + Number(x.metadata?.size ?? 0), 0);
        }),
      );
      return { bytes: sizes.reduce((a, b) => a + b, 0), files: sizes.length };
    }).catch(() => null),
  ]);

  const { data: meetingData, error: meetingError } = meetingsRes.value;
  const meetings = meetingData ?? [];
  const users = usersRes.data?.users ?? [];
  const emailById = new Map(users.map((u) => [u.id, u.email ?? "unknown"]));

  const database: Service = meetingError
    ? { name: "Database", state: "down", detail: meetingError.message }
    : { name: "Database", state: "ok", detail: "Supabase connected", ms: meetingsRes.ms };

  const mb = storageRes ? storageRes.value.bytes / 1_048_576 : 0;
  const storage: Service = storageRes
    ? {
        name: "Audio storage",
        state: "ok",
        detail: mb < 1 ? `${Math.round(mb * 1024)} KB used` : mb < 1024 ? `${mb.toFixed(1)} MB used` : `${(mb / 1024).toFixed(2)} GB used`,
        ms: storageRes.ms,
      }
    : { name: "Audio storage", state: "down", detail: "Couldn’t read the recordings bucket" };

  const totalSeconds = meetings.reduce((s, m) => s + (m.duration_seconds ?? 0), 0);
  const inLast = (m: MeetingRow, from: number, to: number) => {
    const t = new Date(m.started_at).getTime();
    return t >= now - from * DAY && t < now - to * DAY;
  };

  // Last 14 local days, oldest first.
  const daily = dailyCounts(meetings.map((m) => m.started_at), 14, clock, now);

  return {
    database,
    storage,
    users: {
      total: users.length,
      newThisWeek: users.filter((u) => now - new Date(u.created_at).getTime() < 7 * DAY).length,
    },
    meetings: {
      total: meetings.length,
      hours: totalSeconds / 3600,
      thisWeek: meetings.filter((m) => inLast(m, 7, 0)).length,
      lastWeek: meetings.filter((m) => inLast(m, 14, 7)).length,
      avgMinutes: meetings.length ? totalSeconds / meetings.length / 60 : 0,
    },
    daily,
    attention: {
      unfinished: meetings.filter((m) => m.status === "recording" && now - new Date(m.started_at).getTime() > 3 * 3600_000).length,
      stuckNotes: meetings.filter((m) => m.status === "processing" && now - new Date(m.started_at).getTime() > 3600_000).length,
    },
    recent: meetings.slice(0, 8).map((m) => ({
      id: m.id,
      email: emailById.get(m.user_id) ?? "deleted user",
      startedAt: m.started_at,
      duration: m.duration_seconds,
      status: m.status,
      audio: Boolean(m.audio_path),
      notes: Boolean(m.summary),
    })),
  };
}

export type SubscriptionStats = {
  missing: boolean;
  trialing: number;
  active: number;
  cancelling: number;
  failed: number;
  monthlyNaira: number; // paying subscribers × price
};

/** Subscriber counts from Mira's own records (kept in step with Paystack). */
export async function getSubscriptionStats(): Promise<SubscriptionStats> {
  const { data, error } = await createAdminClient().from("subscriptions").select("status, access_until");
  const rows = (data ?? []) as { status: SubStatus; access_until: string | null }[];
  const live = rows.filter((r) => hasAccess(r));
  const active = live.filter((r) => r.status === "active").length;
  return {
    missing: Boolean(error),
    trialing: live.filter((r) => r.status === "trialing").length,
    active,
    cancelling: live.filter((r) => r.status === "non_renewing").length,
    failed: rows.filter((r) => r.status === "attention").length,
    monthlyNaira: active * PRICE_NAIRA,
  };
}
