import "server-only";
import { cookies, headers } from "next/headers";

export type Clock = { timeZone: string; locale: string };

/** The viewer's time zone (from the cookie set by TimeZoneSync) and locale. */
export async function getClock(): Promise<Clock> {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);

  let timeZone = "UTC";
  const tz = cookieStore.get("tz")?.value;
  if (tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      timeZone = tz;
    } catch {
      /* invalid zone → UTC */
    }
  }

  let locale = "en-GB";
  const lang = h.get("accept-language")?.split(",")[0]?.trim();
  if (lang) {
    try {
      new Intl.DateTimeFormat(lang);
      locale = lang;
    } catch {
      /* invalid tag → default */
    }
  }
  return { timeZone, locale };
}

const dayKey = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** "Today", "Yesterday", weekday within the last week, else "March 2026". */
export function dayGroup(iso: string, now: Date, { timeZone, locale }: Clock): string {
  const d = new Date(iso);
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000), timeZone);
  const key = dayKey(d, timeZone);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86_400_000) {
    return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(d);
  }
  return new Intl.DateTimeFormat(locale, { timeZone, month: "long", year: "numeric" }).format(d);
}

export function formatTime(iso: string, { timeZone, locale }: Clock): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string, { timeZone, locale }: Clock): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

export function formatShortDate(iso: string, { timeZone, locale }: Clock): string {
  return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(new Date(iso));
}

export type DayCount = { date: string; label: string; short: string; count: number };

/** How many of `isoDates` fall on each of the last `days` local days, oldest first. */
export function dailyCounts(isoDates: string[], days: number, { timeZone, locale }: Clock, now = Date.now()): DayCount[] {
  const counts = new Map<string, number>();
  for (const iso of isoDates) {
    const k = dayKey(new Date(iso), timeZone);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const long = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" });
  const short = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric" });
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now - (days - 1 - i) * 86_400_000);
    const key = dayKey(d, timeZone);
    return { date: key, label: long.format(d), short: short.format(d), count: counts.get(key) ?? 0 };
  });
}

/** "Good morning" / "Good afternoon" / "Good evening" in the viewer's time zone. */
export function greeting({ timeZone }: Clock, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
