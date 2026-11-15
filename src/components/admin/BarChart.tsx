"use client";

import { useState } from "react";

type Bar = { date: string; label: string; short: string; count: number };

/**
 * Meetings per day. Single series → no legend (the card title names it).
 * Thin bars with rounded tops on a quiet baseline grid, a tooltip on hover /
 * focus, and a screen-reader table with the same numbers.
 */
export function BarChart({ data, unit = "recording" }: { data: Bar[]; unit?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  // A tidy, even top value so the middle gridline is a whole number: 2, 4, 6, 10, 20, …
  const top = [2, 4, 6, 10, 20, 40, 60, 100, 200, 400, 1000].find((n) => n >= max) ?? Math.ceil(max / 2) * 2;
  const empty = data.every((d) => d.count === 0);
  const plural = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const span = `last ${data.length} days`;

  return (
    <div>
      <div className="relative h-44">
        {/* Grid lines + y labels (recessive) */}
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${f * 100}%`, transform: "translateY(50%)" }}>
            <span className="w-6 text-right text-[11px] tabular-nums text-ink-4">{Math.round(top * f)}</span>
            <span className={`h-px flex-1 ${f === 0 ? "bg-line-strong" : "bg-line"}`} />
          </div>
        ))}

        {/* Bars */}
        <div className="absolute inset-y-0 left-8 right-0 flex items-end gap-[3px] sm:gap-1.5" onMouseLeave={() => setActive(null)}>
          {data.map((d, i) => {
            const h = (d.count / top) * 100;
            const isActive = active === i;
            return (
              <div
                key={d.date}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${plural(d.count)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onTouchStart={() => setActive(i)}
                className="group relative flex h-full flex-1 cursor-default items-end justify-center rounded-md outline-none focus-visible:bg-accent-soft"
              >
                {/* Hit area is the full column; the bar is the thin mark inside. */}
                <div
                  className={`w-full max-w-7 rounded-t-[4px] transition-[height,opacity] duration-500 ease-[var(--ease-out)] ${
                    d.count ? "bg-accent" : "bg-transparent"
                  } ${active !== null && !isActive ? "opacity-40" : ""}`}
                  style={{ height: `${h}%`, minHeight: d.count ? 4 : 0 }}
                />
                {isActive && (
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full z-10 mb-2 animate-pop whitespace-nowrap rounded-xl bg-ink px-3 py-2 text-[13px] text-white shadow-[var(--shadow-pop)] ${
                      i < 2 ? "left-0" : i > data.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    <span className="block text-white/70">{d.label}</span>
                    <span className="font-semibold">{plural(d.count)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {empty && (
          <p className="absolute inset-0 left-8 grid place-items-center text-[14px] text-ink-3">No {unit}s in the {span}</p>
        )}
      </div>

      {/* X labels: every other day, plus today */}
      <div className="ml-8 mt-2 flex gap-[3px] sm:gap-1.5">
        {data.map((d, i) => (
          <span key={d.date} className="flex-1 text-center text-[11px] tabular-nums text-ink-4">
            {i === data.length - 1 ? "Today" : i % 2 === 1 ? "" : d.short}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>
          {unit.charAt(0).toUpperCase() + unit.slice(1)}s per day, {span}
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{unit.charAt(0).toUpperCase() + unit.slice(1)}s</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.label}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
