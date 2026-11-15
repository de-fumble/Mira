"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "./ui";

/** Accessible modal confirmation built on the native <dialog> element. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "danger",
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  /** Keeps the confirm button disabled (e.g. until the user types a confirmation). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current && !pending) onClose(); // click on backdrop
      }}
      className="sheet m-auto w-[min(92vw,420px)] rounded-[22px] bg-surface p-0 text-ink shadow-[var(--shadow-pop)]"
    >
      <div className="p-6 pt-3 sm:pt-6">
        {/* Grab handle — phones only, where this shows as a bottom sheet. */}
        <div aria-hidden className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
        <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
        {children && <div className="mt-2 text-[16px] leading-relaxed text-ink-2 sm:text-[15px]">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn btn-md btn-ghost max-sm:h-13 max-sm:bg-sunken max-sm:text-[17px]"
            onClick={onClose}
            disabled={pending}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn btn-md max-sm:h-13 max-sm:text-[17px] ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending && <Spinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
