"use client";

import { useState, useTransition, type ReactNode } from "react";
import { cancelSubscription, type BillingResult } from "@/app/billing-actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Notice, Spinner } from "@/components/ui";

/** A button that runs a billing server action, with a spinner and inline error. */
export function ActionButton({
  action,
  children,
  pendingLabel,
  className = "btn btn-md btn-primary",
}: {
  action: () => Promise<BillingResult>;
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={pending}
        className={className}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await action();
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending && <Spinner />}
        {pending ? pendingLabel : children}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

export function CancelButton({ trial, until }: { trial: boolean; until: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setOpen(true)}>
        {trial ? "Cancel free trial" : "Cancel subscription"}
      </button>
      <ConfirmDialog
        open={open}
        title={trial ? "Cancel your free trial?" : "Cancel your subscription?"}
        confirmLabel={pending ? "Cancelling…" : trial ? "Cancel trial" : "Cancel subscription"}
        pending={pending}
        onClose={() => !pending && setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await cancelSubscription();
            if (res?.error) setError(res.error);
            else setOpen(false);
          })
        }
      >
        <p>
          You won’t be charged again. You can keep using Mira until <strong className="font-semibold text-ink">{until}</strong>, and your
          meetings stay in your account.
        </p>
        {error && (
          <Notice tone="error" className="mt-4">
            {error}
          </Notice>
        )}
      </ConfirmDialog>
    </>
  );
}
