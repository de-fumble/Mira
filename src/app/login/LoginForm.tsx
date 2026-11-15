"use client";

import { Eye, EyeOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { Notice, Spinner } from "@/components/ui";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ signupsEnabled = true, initialMode = "in" }: { signupsEnabled?: boolean; initialMode?: "in" | "up" }) {
  const [chosenMode, setMode] = useState<"in" | "up">(initialMode);
  const mode = signupsEnabled ? chosenMode : "in";
  const [showPassword, setShowPassword] = useState(false);
  const [inState, signInAction, signingIn] = useActionState<AuthState, FormData>(signIn, undefined);
  const [upState, signUpAction, signingUp] = useActionState<AuthState, FormData>(signUp, undefined);

  const state = mode === "in" ? inState : upState;
  const pending = signingIn || signingUp;

  return (
    <div className="w-full">
      {/* Segmented control with sliding indicator (hidden when sign-ups are off) */}
      <div
        role="tablist"
        aria-label="Sign in or create account"
        className={`relative mb-7 grid grid-cols-2 rounded-full bg-sunken p-1 ${signupsEnabled ? "" : "hidden"}`}
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-transform duration-300 ease-[var(--ease-out)]"
          style={{ transform: mode === "up" ? "translateX(100%)" : "none" }}
        />
        {(["in", "up"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`tap relative h-11 rounded-full text-[15px] font-semibold transition-colors sm:h-10 ${
              mode === m ? "text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {m === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form key={mode} action={mode === "in" ? signInAction : signUpAction} className="flex animate-fade-in flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            defaultValue={state?.email}
            required
            className="field"
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Password</span>
          <span className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              required
              minLength={mode === "up" ? 8 : undefined}
              className="field pr-12"
              placeholder={mode === "up" ? "At least 8 characters" : "Your password"}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-1 my-auto grid h-11 w-11 place-items-center rounded-xl text-ink-3 transition hover:bg-hover hover:text-ink active:bg-hover"
            >
              {showPassword ? <EyeOff aria-hidden className="h-[18px] w-[18px]" /> : <Eye aria-hidden className="h-[18px] w-[18px]" />}
            </button>
          </span>
        </label>

        {state?.error && <Notice tone="error">{state.error}</Notice>}
        {state?.message && <Notice tone="success">{state.message}</Notice>}

        <button type="submit" disabled={pending} className="btn btn-lg btn-primary mt-2 w-full">
          {pending && <Spinner className="h-[18px] w-[18px]" />}
          {pending ? (mode === "in" ? "Signing in…" : "Creating account…") : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

/** Shown when an email confirmation link was invalid or expired, or after deleting an account. */
export function LinkError() {
  const params = useSearchParams();
  if (params.get("deleted") === "1") {
    return (
      <Notice tone="success" title="Your account has been deleted" className="mb-6">
        Your meetings, recordings and notes have been removed. Thanks for trying Mira.
      </Notice>
    );
  }
  if (params.get("error") !== "link") return null;
  return (
    <Notice tone="warn" title="That link didn’t work" className="mb-6">
      It may have expired or already been used. Sign in below, or create your account again.
    </Notice>
  );
}
