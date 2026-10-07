"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { FormError } from "./ui/Field";

type Initial = { username: string; display_name: string | null; bio: string | null; interests: string[]; is_private: boolean; show_follow_lists: boolean } | null;

const input = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base";

export function TravelerProfileForm({ initial }: { initial: Initial }) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [interests, setInterests] = useState((initial?.interests ?? []).join(", "));
  const [isPrivate, setIsPrivate] = useState(initial?.is_private ?? false);
  const [showLists, setShowLists] = useState(initial?.show_follow_lists ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username, display_name: displayName, bio,
          interests: interests.split(",").map((s) => s.trim()).filter(Boolean),
          is_private: isPrivate, show_follow_lists: showLists,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(json.error ?? "Could not save. Please try again.");
      else setSaved(true);
    } catch {
      setError("No connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="traveler-heading" className="rounded-2xl border border-line bg-white p-5">
      <h2 id="traveler-heading" className="font-display text-lg font-semibold text-pine">Traveler profile</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {initial ? "This is how other travelers see you when you post." : "Optional. Set this up only if you want to share photos, videos or updates with your name on them. Until then, nothing about you is public."}
      </p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <label className="block text-sm font-semibold">Username
          <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" />
          <span className="mt-1 block text-xs font-normal text-ink-muted">3–24 letters, numbers or _</span>
        </label>
        <label className="block text-sm font-semibold">Name (optional)
          <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
        </label>
        <label className="block text-sm font-semibold">About you (optional)
          <textarea className={`${input} py-2`} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} />
        </label>
        <label className="block text-sm font-semibold">Travel interests (comma separated)
          <input className={input} value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="road trips, beaches, food" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Privacy</legend>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /><span><strong>Private profile</strong> — people must ask to follow you, and only approved followers see your posts.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={showLists} onChange={(e) => setShowLists(e.target.checked)} /><span>Show my follower and following counts to others.</span></label>
        </fieldset>
        <FormError message={error} />
        {saved && <p role="status" className="text-sm font-semibold text-teal-ink">Saved.</p>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save profile" : "Create traveler profile"}</Button>
      </form>
    </section>
  );
}
