"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Spinner } from "../ui";

/** Submit button for the createDocument form. `shortLabel` is used on phones. */
export function NewDocumentButton({ label = "New document", shortLabel }: { label?: string; shortLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn btn-md btn-primary ${shortLabel ? "max-sm:h-10 max-sm:px-4" : ""}`}>
      {pending ? <Spinner /> : <Plus aria-hidden className="h-[18px] w-[18px]" />}
      {pending ? (
        "Creating…"
      ) : shortLabel ? (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="max-sm:hidden">{label}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}
