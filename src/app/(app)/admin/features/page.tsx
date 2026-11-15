import { Suspense } from "react";
import { FeatureSwitch } from "@/components/admin/FeatureSwitch";
import { Notice } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { FEATURES, getFeatureRows } from "@/lib/features";
import { formatShortDate, formatTime, getClock } from "@/lib/time";

export default function AdminFeaturesPage() {
  return (
    <Suspense
      fallback={
        <div className="card divide-y divide-line" aria-busy="true" aria-label="Loading features">
          {FEATURES.map((f) => (
            <div key={f.key} className="flex items-center gap-4 p-6">
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3.5 w-3/4" />
              </div>
              <div className="skeleton h-[31px] w-[51px] rounded-full" />
            </div>
          ))}
        </div>
      }
    >
      <Features />
    </Suspense>
  );
}

async function Features() {
  await requireAdmin();
  const [{ rows, tableMissing }, clock] = await Promise.all([getFeatureRows(), getClock()]);

  return (
    <div className="flex flex-col gap-5">
      {tableMissing && (
        <Notice tone="warn" title="One-time setup needed">
          The switches need a small settings table. In Supabase, open <strong>SQL Editor → New query</strong>, paste the
          contents of <code className="rounded bg-surface px-1">supabase/migrations/0002_app_settings.sql</code>, and click{" "}
          <strong>Run</strong>. Until then everything uses its default.
        </Notice>
      )}

      <ul className="card divide-y divide-line">
        {FEATURES.map((f) => {
          const row = rows.find((r) => r.key === f.key)!;
          const danger = f.key === "maintenance";
          return (
            <li key={f.key} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold">{f.label}</h2>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-3">{f.description}</p>
                {row.updated_by && row.updated_at && (
                  <p className="mt-1.5 text-[12px] text-ink-4">
                    Turned {row.enabled ? "on" : "off"} by {row.updated_by} · {formatShortDate(row.updated_at, clock)},{" "}
                    {formatTime(row.updated_at, clock)}
                  </p>
                )}
              </div>
              <FeatureSwitch
                featureKey={f.key}
                label={f.label}
                enabled={row.enabled}
                danger={danger}
                disabled={tableMissing}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-[13px] text-ink-3">
        Changes apply right away (maintenance mode within about 10 seconds). Admins are never locked out by maintenance
        mode.
      </p>
    </div>
  );
}
