"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Spinner } from "../ui";

/** Submit button for the createDocument form. */
export function NewDocumentButton({ label = "New document" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-md btn-primary">
      {pending ? <Spinner /> : <Plus aria-hidden className="h-[18px] w-[18px]" />}
      {pending ? "Creating…" : label}
    </button>
  );
}
