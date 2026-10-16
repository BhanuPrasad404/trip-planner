"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";
import { RESEND_COOLDOWN_S, RESET_PATH, looksLikeEmail, resetRequestOutcome } from "@/lib/password-reset";

export function ForgotPasswordForm({ initialError = null }: { initialError?: string | null }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!looksLikeEmail(email)) {
      setError("Enter the email address you use to log in.");
      return;
    }
    setLoading(true);
    let outcome: ReturnType<typeof resetRequestOutcome>;
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        // Used by Supabase's default email link (code flow). The recommended email template links to /auth/confirm instead.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(RESET_PATH)}`,
      });
      outcome = resetRequestOutcome(error);
    } catch {
      outcome = resetRequestOutcome(null, true);
    } finally {
      setLoading(false);
    }
    if (outcome.kind === "offline") return setError(outcome.message);
    setNotice(outcome.message);
    setCooldown(RESEND_COOLDOWN_S);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full max-w-md space-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">Forgot your password?</h1>
        <p className="mt-1.5 text-base text-ink-muted">Enter your email and we&apos;ll send you a link to set a new one.</p>
      </div>

      <TextField label="Email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />

      <FormError message={error} />
      {notice && (
        <p role="status" className="rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">
          {notice}
        </p>
      )}

      <Button type="submit" loading={loading} loadingLabel="Sending…" disabled={cooldown > 0} className="w-full">
        {cooldown > 0 ? `Send again in ${cooldown}s` : notice ? "Send the link again" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-teal-ink underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
