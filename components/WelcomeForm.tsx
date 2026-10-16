"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LEGAL_VERSION } from "@/lib/legal";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";

export function WelcomeForm({ next, initialName, email }: { next: string; initialName: string; email: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreed) return setError("Please tick the box to confirm you agree to the Terms and the Privacy Policy.");
    setBusy(true);
    try {
      const supabase = createClient();
      // Kept with the person's own account record, exactly like email sign-up.
      const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() || undefined, accepted_terms_version: LEGAL_VERSION, accepted_terms_at: new Date().toISOString() } });
      if (error) { setError("We couldn't save that. Please try again."); return; }
      // A fresh login token carries the agreement, so the app stops sending you back here.
      await supabase.auth.refreshSession().catch(() => undefined);
      router.replace(next);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await createClient().auth.signOut().catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={save} noValidate className="w-full max-w-md space-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">One more step</h1>
        <p className="mt-1.5 text-base text-ink-muted">{email ? `You signed in with Google as ${email}.` : "You signed in with Google."}</p>
      </div>
      <TextField label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} hint="Shown to your travel group. You can change it." />
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-teal" />
        <span>I am 18 or older and I agree to the <Link href="/terms" target="_blank" className="font-semibold text-teal-ink underline underline-offset-2">Terms of Use</Link> and the <Link href="/privacy" target="_blank" className="font-semibold text-teal-ink underline underline-offset-2">Privacy Policy</Link>.</span>
      </label>
      <FormError message={error} />
      <Button type="submit" loading={busy} loadingLabel="Saving…" className="w-full">Continue</Button>
      <button type="button" onClick={cancel} className="w-full text-center text-sm font-semibold text-ink-muted underline underline-offset-2">Cancel and sign out</button>
    </form>
  );
}
