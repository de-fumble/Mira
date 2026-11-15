"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Spinner } from "./ui";

/** Searches as you type (debounced), keeping the query in the URL. */
export function SearchField() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  const push = (q: string) => {
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // "/" focuses search, like many apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative w-full sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        window.clearTimeout(timer.current);
        push(value);
      }}
    >
      <label htmlFor="q" className="sr-only">Search meetings</label>
      <span className="pointer-events-none absolute inset-y-0 left-3.5 grid place-items-center text-ink-3">
        {pending ? <Spinner className="h-[18px] w-[18px]" /> : <Search aria-hidden className="h-[18px] w-[18px]" />}
      </span>
      <input
        ref={input}
        id="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => push(v), 250);
        }}
        placeholder="Search meetings"
        className="field !h-11 bg-surface pl-10 pr-10 shadow-[inset_0_0_0_1px_var(--color-line)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setValue("");
            window.clearTimeout(timer.current);
            push("");
            input.current?.focus();
          }}
          className="group/clear absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-3"
        >
          {/* 44px tap area, small visible circle */}
          <span className="grid h-7 w-7 place-items-center rounded-full transition group-hover/clear:bg-hover group-hover/clear:text-ink group-active/clear:bg-hover">
            <X aria-hidden className="h-4 w-4" />
          </span>
        </button>
      )}
    </form>
  );
}
