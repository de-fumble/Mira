"use client";

import { Check, Copy, Trash } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteMeeting } from "@/app/actions";
import { ConfirmDialog } from "./ConfirmDialog";
import { DownloadMenu } from "./DownloadMenu";

/** Copy / download (Word, PDF, text) / delete for one meeting. */
export function MeetingActions({ meetingId, title, text }: { meetingId: string; title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();

  const exportText = `${title}\n\n${text}\n`;

  const copy = async () => {
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {text && (
          <>
            <button type="button" onClick={copy} className="btn btn-sm btn-secondary" aria-live="polite">
              {copied ? <Check aria-hidden className="h-4 w-4 animate-pop text-success" /> : <Copy aria-hidden className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <DownloadMenu endpoint={`/api/meetings/${meetingId}/export`} title={title} text={exportText} menuLabel="Download transcript as" />
          </>
        )}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn btn-icon btn-danger-ghost sm:h-9! sm:w-9!"
          aria-label="Delete meeting"
          title="Delete meeting"
        >
          <Trash aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete this meeting?"
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        pending={deleting}
        onClose={() => setConfirming(false)}
        onConfirm={() => startDelete(() => deleteMeeting(meetingId))}
      >
        The recording, transcript and notes will be permanently removed. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}
