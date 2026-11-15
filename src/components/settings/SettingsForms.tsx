"use client";

import { CircleCheck, Eye, EyeOff, Trash } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { changePassword, deleteAccount, updateUsername, type FormState } from "@/app/settings-actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Notice, Spinner } from "@/components/ui";
import { PASSWORD_MIN, USERNAME_MAX } from "@/lib/account";

/** Quiet inline "Saved" confirmation that fades in next to the button. */
function Saved({ state }: { state: FormState }) {
  if (!state?.ok) return null;
  return (
    <p key={state.at} role="status" className="flex animate-fade-in items-center gap-1.5 text-[14px] font-medium text-success">
      <CircleCheck aria-hidden className="h-4 w-4" />
      {state.ok}
    </p>
  );
}

export function UsernameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUsername, undefined);
  const [value, setValue] = useState(current ?? "");
  const unchanged = value.replace(/\s+/g, " ").trim() === (current ?? "");

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Username</span>
        <input
          name="username"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={USERNAME_MAX}
          autoComplete="nickname"
          autoCapitalize="words"
          enterKeyHint="done"
          placeholder="What should Mira call you?"
          className="field"
          aria-describedby="username-help"
        />
        <span id="username-help" className="flex justify-between text-[13px] text-ink-3">
          <span>Shown in your greeting and account menu.</span>
          <span className="tabular-nums text-ink-4">
            {value.length}/{USERNAME_MAX}
          </span>
        </span>
      </label>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending || unchanged} className="btn btn-md btn-primary">
          {pending && <Spinner />}
          {pending ? "Saving…" : "Save username"}
        </button>
        {!pending && unchanged && <Saved state={state} />}
      </div>
    </form>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, undefined);
  const [show, setShow] = useState(false);
  const type = show ? "text" : "password";
  const common = { type, autoCapitalize: "none", autoCorrect: "off", spellCheck: false, required: true, className: "field pr-12" } as const;

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" name="account" autoComplete="username" value={email} hidden readOnly />
      <label className="flex flex-col gap-1.5">
        <span className="label">Current password</span>
        <span className="relative">
          <input {...common} name="current" autoComplete="current-password" enterKeyHint="next" placeholder="Your current password" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide passwords" : "Show passwords"}
            aria-pressed={show}
            className="tap absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            {show ? <EyeOff aria-hidden className="h-[18px] w-[18px]" /> : <Eye aria-hidden className="h-[18px] w-[18px]" />}
          </button>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">New password</span>
          <input {...common} name="password" autoComplete="new-password" minLength={PASSWORD_MIN} enterKeyHint="next" placeholder={`At least ${PASSWORD_MIN} characters`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Confirm new password</span>
          <input {...common} name="confirm" autoComplete="new-password" minLength={PASSWORD_MIN} enterKeyHint="go" placeholder="Type it again" />
        </label>
      </div>
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && !pending && <Notice tone="success">{state.ok}</Notice>}
      <div>
        <button type="submit" disabled={pending} className="btn btn-md btn-primary">
          {pending && <Spinner />}
          {pending ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

export function DeleteAccount({ email, meetings, isOwner }: { email: string; meetings: number; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  if (isOwner) {
    return (
      <p className="rounded-2xl bg-sunken px-4 py-3.5 text-[15px] text-ink-2">
        This is the owner account that runs Mira and the admin dashboard, so it can’t be deleted here.
      </p>
    );
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setError(null); setTyped(""); }} className="btn btn-md btn-danger">
        <Trash aria-hidden className="h-4 w-4" />
        Delete my account
      </button>
      <ConfirmDialog
        open={open}
        title="Delete your account?"
        confirmLabel={pending ? "Deleting…" : "Delete forever"}
        pending={pending}
        confirmDisabled={!matches}
        onClose={() => !pending && setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteAccount(typed);
            if (res?.error) setError(res.error);
          })
        }
      >
        <p>
          This permanently removes your account
          {meetings > 0 && (
            <>
              {" "}and <strong className="font-semibold text-ink">{meetings === 1 ? "your 1 meeting" : `all ${meetings} meetings`}</strong>, with their
              recordings, transcripts and notes
            </>
          )}
          . It can’t be undone.
        </p>
        <label className="mt-5 flex flex-col gap-1.5">
          <span className="text-[14px] font-medium text-ink-2">
            Type <span className="font-semibold text-ink">{email}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            className="field"
            placeholder={email}
          />
        </label>
        {error && <Notice tone="error" className="mt-4">{error}</Notice>}
      </ConfirmDialog>
    </>
  );
}
