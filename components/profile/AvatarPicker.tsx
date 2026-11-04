"use client";

// The profile picture control: a big round picture with a camera badge, "Add a photo" / "Change photo" / "Remove". Entirely optional: without
// a picture the person shows as their initial. Picking opens the editor (drag and zoom); "Use this photo" uploads one small square file to the
// person's own folder, and (when the traveler profile already exists) points the profile at it at once. Before the profile exists the new
// path is handed to the form and saved with it. Nothing about the original photo is kept.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Glyph } from "@/components/ui/Glyph";
import { AvatarEditor, type AvatarResult } from "./AvatarEditor";
import { AVATAR_BUCKET, AVATAR_PICK_MAX_BYTES, avatarUrl, newAvatarPath } from "@/lib/avatar";
import { createClient } from "@/lib/supabase/client";
import { clearSnapshot } from "@/lib/client/feed-snapshot";

type Props = {
  userId: string;
  /** The picture now (a storage path) or null. */
  path: string | null;
  /** What to show without a picture. */
  initial: string;
  /** The traveler profile exists: a change is saved at once. Otherwise it is held for the form's Save button. */
  hasProfile: boolean;
  onChange: (path: string | null) => void;
};

export function AvatarPicker({ userId, path, initial, hasProfile, onChange }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function picked(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Please choose a photo (JPEG, PNG or WebP).");
    if (f.size > AVATAR_PICK_MAX_BYTES) return setError("That photo is too big. Choose one under 15 MB.");
    setFile(f);
  }

  async function save(next: string | null) {
    if (!hasProfile) return;                                         // held for the form: it saves the picture with the profile
    const res = await fetch("/api/profile/avatar", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: next }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save your picture.");
    showEverywhere();
  }

  /** The menu, the header and every post of yours are drawn by the server or remembered by this tab: tell both, so the new picture shows at once. */
  function showEverywhere() {
    try { clearSnapshot(window.sessionStorage); } catch { /* private mode: the feed starts fresh anyway */ }
    router.refresh();
  }

  async function upload(r: AvatarResult) {
    setBusy(true); setError(null);
    const next = newAvatarPath(userId, r.ext);
    try {
      const { error } = await createClient().storage.from(AVATAR_BUCKET).upload(next, r.blob, { contentType: r.blob.type, cacheControl: "31536000", upsert: false });
      if (error) throw new Error(/bucket not found|not found/i.test(error.message) ? "Profile pictures aren't switched on yet. Please try again later." : "Couldn't upload that picture. Check your connection and try again.");
      try { await save(next); } catch (e) { void createClient().storage.from(AVATAR_BUCKET).remove([next]); throw e; }
      onChange(next);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your picture.");
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    try { await save(null); onChange(null); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't remove your picture."); } finally { setBusy(false); }
  }

  const src = avatarUrl(path);
  const has = !!path;                                                // a picture is set even if its address cannot be built here
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
      <div className="relative">
        <Avatar src={src} initial={initial} size={104} className="shadow-float ring-4 ring-white" />
        <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label={has ? "Change profile photo" : "Add a profile photo"}
          className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center rounded-full bg-pine text-white shadow-float ring-2 ring-white transition active:scale-90 disabled:opacity-60">
          <Glyph name="camera" size={20} />
        </button>
        <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { picked(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <div className="min-w-0 text-center sm:text-left">
        <p className="font-semibold text-pine">Profile photo <span className="font-normal text-ink-muted">(optional)</span></p>
        <p className="mt-0.5 text-sm text-ink-muted">{has ? "Shown next to your posts and on your profile." : "Add a face to your posts. Without one, your initial is shown."}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="tm-action">{has ? "Change photo" : "Add a photo"}</button>
          {has && <button type="button" onClick={() => void remove()} disabled={busy} className="tm-action-quiet">Remove</button>}
        </div>
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-clay-ink">{error}</p>}
      </div>
      {file && <AvatarEditor file={file} onDone={upload} onCancel={() => setFile(null)} />}
    </div>
  );
}
