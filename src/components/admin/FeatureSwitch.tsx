"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFeature } from "@/app/admin-actions";
import { Spinner } from "../ui";

/** On/off switch for one feature. Flips instantly, rolls back if saving fails. */
export function FeatureSwitch({
  featureKey,
  label,
  enabled: initial,
  danger = false,
  disabled = false,
}: {
  featureKey: string;
  label: string;
  enabled: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setFeature(featureKey, next);
      if (result.error) {
        setEnabled(!next);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const onColor = danger ? "bg-rec" : "bg-success";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2.5">
        {pending && <Spinner className="h-4 w-4 text-ink-3" />}
        <span className={`text-[13px] font-medium ${enabled ? (danger ? "text-rec" : "text-success") : "text-ink-3"}`}>
          {enabled ? "On" : "Off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          disabled={pending || disabled}
          onClick={toggle}
          className={`tap relative h-[31px] w-[51px] flex-none rounded-full transition-colors duration-200 disabled:opacity-50 ${
            enabled ? onColor : "bg-[#e3e3e8]"
          }`}
        >
          <span
            aria-hidden
            className="absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-200 ease-[var(--ease-out)]"
            style={{ transform: enabled ? "translateX(20px)" : "none" }}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="max-w-xs text-right text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
