"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, LinkButton } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";
import { MIN_PASSWORD_LENGTH, RESET_EXPIRED_MESSAGE, passwordUpdateError, validateNewPassword } from "@/lib/password-reset";

/** `hasSession` comes from the server: the reset link signs the person in. Without a session the link is spent or expired. */
export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(!hasSession);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = validateNewPassword(password, confirm);
    if (invalid) return setError(invalid);

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        const message = passwordUpdateError(error);
        if (message === RESET_EXPIRED_MESSAGE) setExpired(true);
        else setError(message);
        return;
      }
      // Anyone who knew the old password is logged out on their devices; this device stays signed in.
      await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
      setDone(true);
    } catch {
      setError(passwordUpdateError({ status: 0 }));
    } finally {
      setLoading(false);
    }
  }

  const card = "w-full max-w-md space-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8";

  if (done) {
    return (
      <div className={card}>
        <h1 className="font-display text-3xl font-semibold text-pine">Password changed</h1>
        <p role="status" className="text-base text-ink-muted">
          Your new password is saved. Other devices that were logged in have been logged out.
        </p>
        <LinkButton href="/trips" className="w-full">Go to my trips</LinkButton>
      </div>
    );
  }

  if (expired) {
    return (
      <div className={card}>
        <h1 className="font-display text-3xl font-semibold text-pine">Link expired</h1>
        <p role="alert" className="text-base text-ink-muted">{RESET_EXPIRED_MESSAGE}</p>
        <LinkButton href="/forgot-password?expired=1" className="w-full">Get a new link</LinkButton>
        <p className="text-center text-sm text-ink-muted">
          <Link href="/login" className="font-semibold text-teal-ink underline underline-offset-2">Back to log in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={card}>
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">Set a new password</h1>
        <p className="mt-1.5 text-base text-ink-muted">Choose a password you don&apos;t use anywhere else.</p>
      </div>
      <TextField label="New password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
      <TextField label="Type it again" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <FormError message={error} />
      <Button type="submit" loading={loading} loadingLabel="Saving…" className="w-full">Save new password</Button>
    </form>
  );
}
