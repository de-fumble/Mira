import { CircleCheck, CircleExclamationPoint, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <LoaderCircle aria-hidden className={`animate-spin ${className}`} strokeWidth={2.25} />;
}

const tones = {
  info: { box: "bg-accent-soft text-ink", icon: "text-accent", Icon: Info },
  warn: { box: "bg-warn-soft text-ink", icon: "text-warn", Icon: CircleExclamationPoint },
  error: { box: "bg-danger-soft text-ink", icon: "text-danger", Icon: CircleExclamationPoint },
  success: { box: "bg-success-soft text-ink", icon: "text-success", Icon: CircleCheck },
} as const;

/** Inline message with an icon. Use instead of bare red text. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: keyof typeof tones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex animate-fade-up items-start gap-3 rounded-2xl px-4 py-3.5 text-left ${t.box} ${className}`}
    >
      <t.Icon aria-hidden className={`mt-0.5 h-5 w-5 flex-none ${t.icon}`} strokeWidth={2.25} />
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

const SPEAKER_TEXT = ["text-spk-0", "text-spk-1", "text-spk-2", "text-spk-3", "text-spk-4", "text-spk-5"];
const SPEAKER_BG = ["bg-spk-0", "bg-spk-1", "bg-spk-2", "bg-spk-3", "bg-spk-4", "bg-spk-5"];
export const speakerText = (s: number) => SPEAKER_TEXT[s % SPEAKER_TEXT.length];
export const speakerBg = (s: number) => SPEAKER_BG[s % SPEAKER_BG.length];

/** Small round badge with the speaker number. */
export function SpeakerBadge({ speaker, size = "md" }: { speaker: number; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-6 w-6 text-[11px]" : "h-8 w-8 text-[13px]";
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center rounded-full font-semibold text-white ${dims} ${speakerBg(speaker)}`}
    >
      {speaker + 1}
    </span>
  );
}
