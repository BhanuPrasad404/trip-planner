"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { googleRedirectTo, oauthErrorMessage } from "@/lib/oauth";
import { FormError } from "./ui/Field";

/**
 * "Continue with Google" (Supabase OAuth). Google sends the person back to /auth/callback with a safe next path.
 * `blockedReason`: shown instead of starting, e.g. on the sign-up page until the Terms box is ticked.
 */
export function GoogleButton({ next, blockedReason = null }: { next: string; blockedReason?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    if (blockedReason) return setError(blockedReason);
    setBusy(true);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        // select_account: always show Google's account chooser, so a shared phone never silently uses the last account.
        options: { redirectTo: googleRedirectTo(window.location.origin, next), queryParams: { prompt: "select_account" } },
      });
      if (error) { setError(oauthErrorMessage(error)); setBusy(false); }
      // On success the browser is on its way to Google; keep the button busy.
    } catch {
      setError(oauthErrorMessage({ status: 0 }));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        aria-busy={busy || undefined}
        className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-white px-5 text-base font-semibold text-ink hover:bg-sky disabled:opacity-60"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      <FormError message={error} />
    </div>
  );
}
