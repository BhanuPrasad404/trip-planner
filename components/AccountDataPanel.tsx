"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { useAction } from "@/lib/client/use-action";

async function problemFrom(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** Profile → "Your data": download everything we hold, or delete the account for good. */
export function AccountDataPanel({ email }: { email: string }) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);

  const download = useAction(async () => {
    const res = await fetch("/api/account/export");
    if (!res.ok) throw new Error(await problemFrom(res, "We couldn't prepare your data. Please try again."));
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "trailmate-my-data.json";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, { fallbackError: "We couldn't prepare your data. Please try again." });

  const remove = useAction(async () => {
    const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm, password }) });
    if (!res.ok) throw new Error(await problemFrom(res, "We couldn't delete your account. Please try again."));
    // A full page load on purpose (not a client-side navigation): the account and this browser's session no longer exist, so every cached page must go.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login?deleted=1");
  }, { fallbackError: "We couldn't delete your account. Please try again." });

  return (
    <section aria-labelledby="data-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="data-heading" className="font-display text-lg font-semibold text-pine">Your data</h2>
      <p className="mt-1 text-sm text-ink-muted">You are in control of what Trailmate keeps. Read how we use it in the <Link href="/privacy" className="font-semibold text-teal-ink underline underline-offset-2">Privacy Policy</Link> and the <Link href="/terms" className="font-semibold text-teal-ink underline underline-offset-2">Terms of Use</Link>.</p>

      <div className="mt-4 rounded-xl border border-line bg-sky p-4">
        <h3 className="font-semibold text-pine">Download my data</h3>
        <p className="mt-1 text-sm text-ink-muted">One file with your account, profile, trips and stops, votes, posts, comments, likes, saves, reports, feedback and links to your photos and videos. You can download it 3 times an hour.</p>
        <Button className="mt-3" variant="secondary" loading={download.pending} loadingLabel="Preparing your file…" onClick={() => void download.run()}>Download my data</Button>
        <FormError message={download.error} />
      </div>

      <div className="mt-4 rounded-xl border border-[#E7B7A6] bg-[#FBEAE2] p-4">
        <h3 className="font-semibold text-[#8F3A18]">Delete my account</h3>
        {!open ? (
          <>
            <p className="mt-1 text-sm text-[#6B2D12]">This permanently deletes your account and everything that is yours. It cannot be undone.</p>
            <Button className="mt-3" variant="secondary" onClick={() => setOpen(true)}>I want to delete my account</Button>
          </>
        ) : (
          <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); void remove.run(); }}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[#6B2D12]">
              <li>Your profile, posts, photos and videos, comments, likes, votes, reports and feedback are erased.</li>
              <li>A trip you own that other people are on is handed to the person who has been on it longest. A trip only you are on is deleted.</li>
              <li>Stops you added to a group trip stay there, without your name.</li>
              <li>Consider downloading your data first. After this we cannot get it back.</li>
            </ul>
            <TextField label="Type your email address to confirm" type="email" autoComplete="off" placeholder={email} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <FormError message={remove.error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={remove.pending} loadingLabel="Deleting…" disabled={!confirm.trim() || !password} className="bg-[#C0392B] text-white hover:bg-[#A93226]">Permanently delete my account</Button>
              <Button type="button" variant="secondary" disabled={remove.pending} onClick={() => { setOpen(false); setConfirm(""); setPassword(""); remove.clearError(); }}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
