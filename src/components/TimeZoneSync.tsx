"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Stores the viewer's time zone in a cookie so the server can show times in
 * their local zone. Re-renders once on the first visit (or after travelling).
 */
export function TimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1];
    if (tz && decodeURIComponent(current ?? "") !== tz) {
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [router]);
  return null;
}
