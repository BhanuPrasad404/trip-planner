"use client";

// The traveler profile: who you are to other travelers. Optional: nothing about you is public until you set this up. A soft, rounded card
// (a profile photo you may add or skip, one icon-led field per line, tap-to-add interests, two privacy switches) and one clear Save button.
import { useState } from "react";
import { AvatarPicker } from "./profile/AvatarPicker";
import { Glyph } from "./ui/Glyph";
import { FormError } from "./ui/Field";
import type { GlyphName } from "@/lib/glyphs";
import { initialOf } from "@/lib/feed/people";

type Initial = { username: string; display_name: string | null; bio: string | null; interests: string[]; is_private: boolean; show_follow_lists: boolean; avatar_path?: string | null } | null;

const pill = "mt-2 min-h-12 w-full rounded-2xl border border-line bg-sky/60 px-4 text-base text-ink placeholder:text-ink-muted/70 transition-colors focus:border-teal focus:bg-white";
const IDEAS = ["road trips", "beaches", "food", "mountains", "temples", "waterfalls", "wildlife", "photography", "heritage", "camping"];

function Label({ icon, children, hint }: { icon: GlyphName; children: React.ReactNode; hint?: string }) {
  return (
    <span className="flex items-center gap-3 text-base font-semibold text-pine">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-pine shadow-card ring-1 ring-line"><Glyph name={icon} size={20} /></span>
      <span>{children}{hint && <span className="font-normal text-ink-muted"> {hint}</span>}</span>
    </span>
  );
}

export function TravelerProfileForm({ initial, userId, fallbackName = "" }: { initial: Initial; userId: string; fallbackName?: string }) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [interests, setInterests] = useState((initial?.interests ?? []).join(", "));
  const [isPrivate, setIsPrivate] = useState(initial?.is_private ?? false);
  const [showLists, setShowLists] = useState(initial?.show_follow_lists ?? true);
  const [avatar, setAvatar] = useState<string | null>(initial?.avatar_path ?? null);
  const [avatarTouched, setAvatarTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const have = interests.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const toggleIdea = (i: string) => setInterests((have.includes(i) ? have.filter((x) => x !== i) : [...have, i].slice(0, 8)).join(", "));

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
          ...(avatarTouched ? { avatar_path: avatar } : {}),       // untouched: the picture is left exactly as it is
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(json.error ?? "Could not save. Please try again.");
      else { setSaved(true); setAvatarTouched(false); }
    } catch {
      setError("No connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="traveler-heading" className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-float backdrop-blur sm:p-7">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal-light text-teal-ink"><Glyph name="compass" size={28} /></span>
        <div className="min-w-0">
          <h2 id="traveler-heading" className="font-display text-2xl font-semibold leading-tight text-pine sm:text-3xl">{initial ? "Your traveler profile" : "Create your traveler profile"}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {initial ? "This is how other travelers see you when you post." : "Optional. Set this up only if you want to share photos, videos or updates with your name on them. Until then, nothing about you is public."}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-3xl bg-sky/60 p-4 sm:p-5">
        <AvatarPicker userId={userId} path={avatar} initial={initialOf(username || fallbackName || "?", displayName || fallbackName)} hasProfile={!!initial} onChange={(p) => { setAvatar(p); setAvatarTouched(true); }} />
      </div>

      <form onSubmit={save} className="mt-6 space-y-6">
        <label className="block">
          <Label icon="at">Username</Label>
          <input className={pill} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" placeholder="e.g. ravi_travels" />
          <span className="mt-1.5 block text-xs text-ink-muted">3–24 letters, numbers or _</span>
        </label>
        <label className="block">
          <Label icon="user" hint="(optional)">Name</Label>
          <input className={pill} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="e.g. Ravi Kumar" />
        </label>
        <label className="block">
          <Label icon="chat" hint="(optional)">About you</Label>
          <textarea className={`${pill} min-h-[5.5rem] resize-none py-3`} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} placeholder="Tell us what kind of trip you're looking for…" />
          <span className="mt-1 block text-right text-xs text-ink-muted">{bio.length}/160</span>
        </label>
        <div>
          <label className="block"><Label icon="star">Travel interests</Label>
            <input className={pill} value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="road trips, beaches, food, mountains…" />
          </label>
          <div role="group" aria-label="Pick interests" className="mt-3 flex flex-wrap gap-2">
            {IDEAS.map((i) => (
              <button key={i} type="button" aria-pressed={have.includes(i)} onClick={() => toggleIdea(i)} className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition active:scale-95 ${have.includes(i) ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted hover:border-teal hover:text-pine"}`}>{i}</button>
            ))}
          </div>
        </div>

        <fieldset className="space-y-2.5">
          <legend className="mb-1"><Label icon="shield">Privacy</Label></legend>
          <label className="flex cursor-pointer items-start gap-3.5 rounded-2xl border border-line bg-white p-4 text-sm transition-colors hover:border-teal/50">
            <input type="checkbox" className="mt-0.5" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            <span><strong className="text-pine">Private profile</strong> — people must ask to follow you, and only approved followers see your posts.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-3.5 rounded-2xl border border-line bg-white p-4 text-sm transition-colors hover:border-teal/50">
            <input type="checkbox" className="mt-0.5" checked={showLists} onChange={(e) => setShowLists(e.target.checked)} />
            <span>Show my follower and following counts to others.</span>
          </label>
        </fieldset>

        <FormError message={error} />
        {saved && <p role="status" className="flex items-center gap-2 rounded-2xl bg-teal-light px-4 py-3 text-sm font-semibold text-teal-ink"><Glyph name="checkCircle" size={18} />Saved. Your profile is up to date.</p>}

        <button type="submit" disabled={busy} className="group relative isolate flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-pine via-pine to-teal text-lg font-semibold text-white shadow-float transition active:scale-[0.98] disabled:opacity-70">
          <svg aria-hidden="true" viewBox="0 0 400 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-full w-full opacity-30"><path d="M0 60V38c40-18 70-14 110 2 40-24 90-26 130-4 40-14 100-8 160 12v12z" fill="var(--teal)" /></svg>
          <Glyph name="sparkles" size={20} className="text-marigold" />{busy ? "Saving…" : initial ? "Save profile" : "Create traveler profile"}<Glyph name="arrow" size={20} className="transition-transform group-hover:translate-x-1" />
        </button>
      </form>
    </section>
  );
}
