"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { Button } from "@/components/ui/Button";
import { prepareVideo, preparePhoto, type PreparedMedia } from "@/lib/client/prepare-media";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_LIMITS, POST_MEDIA_BUCKET } from "@/lib/social/media";
import { Sheet } from "./Sheet";
import { CameraIcon, CloseIcon } from "./icons";

type Item = { id: string; name: string; status: "preparing" | "ready" | "error"; error?: string; media?: PreparedMedia; preview?: string };
type Uploaded = { path: string; posterPath: string | null };

const WHEN: [string, string, number | null][] = [
  ["now", "Just now", null], ["today", "Earlier today", 6], ["yesterday", "Yesterday", 30], ["week", "This week", 96], ["older", "Earlier than a week ago", 24 * 30],
];

async function uploadOne(blob: Blob, mime: string, bytes: number): Promise<string> {
  const res = await fetch("/api/posts/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mime, bytes }) });
  const j = await res.json().catch(() => null);
  if (res.status === 409) throw Object.assign(new Error("Set up your traveler profile first."), { needsProfile: true });
  if (!res.ok) throw new Error(j?.error ?? "Couldn't start the upload.");
  const { error } = await createClient().storage.from(POST_MEDIA_BUCKET).uploadToSignedUrl(j.path, j.token, blob, { contentType: mime });
  if (error) throw new Error("The upload didn't finish. Check your connection and try again.");
  return j.path as string;
}

export function Composer({ hasProfile, onClose, onPosted }: { hasProfile: boolean; onClose: () => void; onPosted: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dest, setDest] = useState<PickedPlace | null>(null);
  const [spot, setSpot] = useState("");
  const [caption, setCaption] = useState("");
  const [precision, setPrecision] = useState<"approx" | "exact">("approx");
  const [when, setWhen] = useState("now");
  const [phase, setPhase] = useState<"form" | "uploading">("form");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<{ message: string; needsProfile?: boolean } | null>(null);
  const done = useRef(new Map<string, Uploaded>());           // finished uploads survive a retry: nothing is sent twice
  const input = useRef<HTMLInputElement>(null);

  const hasVideo = items.some((i) => i.media?.type === "video" || i.name.match(/\.(mp4|webm|mov)$/i));
  const photoCount = items.filter((i) => i.media?.type === "image").length;
  const ready = items.length > 0 && items.every((i) => i.status === "ready");
  const kind = hasVideo ? "video" : items.length > 0 ? "photo" : "report";
  const canPost = hasProfile && !!dest && phase === "form" && (items.length === 0 ? caption.trim().length > 0 : ready);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    for (const file of Array.from(list)) {
      const isVideo = file.type.startsWith("video/");
      const id = crypto.randomUUID();
      if (isVideo && items.length > 0) { setError({ message: "Add one video on its own, or up to 4 photos." }); continue; }
      if (!isVideo && (hasVideo || photoCount + items.filter((i) => i.status === "preparing").length >= MEDIA_LIMITS.mediaPerPost)) { setError({ message: `You can add up to ${MEDIA_LIMITS.mediaPerPost} photos, or one video.` }); continue; }
      setItems((cur) => [...cur, { id, name: file.name, status: "preparing" }]);
      try {
        const media = isVideo ? await prepareVideo(file) : await preparePhoto(file);
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "ready", media, preview: URL.createObjectURL(media.poster?.blob ?? media.blob) } : i)));
      } catch (e) {
        setItems((cur) => cur.map((i) => (i.id === id ? { ...i, status: "error", error: e instanceof Error ? e.message : "Couldn't use that file." } : i)));
      }
    }
    if (input.current) input.current.value = "";
  }

  function remove(id: string) {
    setItems((cur) => { const it = cur.find((i) => i.id === id); if (it?.preview) URL.revokeObjectURL(it.preview); return cur.filter((i) => i.id !== id); });
    done.current.delete(id);
  }

  async function submit() {
    if (!canPost || !dest) return;
    setPhase("uploading"); setError(null);
    try {
      const media = [] as { storage_path: string; poster_path: string | null; media_type: "image" | "video"; mime: string; bytes: number; width: number; height: number; duration_s: number | null }[];
      let n = 0;
      for (const it of items) {
        const m = it.media!;
        n++; setProgress(`Uploading ${n} of ${items.length}…`);
        let up = done.current.get(it.id);
        if (!up) {
          const path = await uploadOne(m.blob, m.mime, m.blob.size);
          const posterPath = m.poster ? await uploadOne(m.poster.blob, m.poster.mime, m.poster.blob.size).catch(() => null) : null;   // a missing poster is fine
          up = { path, posterPath };
          done.current.set(it.id, up);
        }
        media.push({ storage_path: up.path, poster_path: up.posterPath, media_type: m.type, mime: m.mime, bytes: m.blob.size, width: m.width, height: m.height, duration_s: m.durationS });
      }
      setProgress("Publishing…");
      const hours = WHEN.find((w) => w[0] === when)?.[2] ?? null;
      const res = await fetch("/api/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, caption: caption.trim() || null, place_name: spot.trim() || dest.name, destination_name: dest.name,
          lat: dest.lat, lng: dest.lng, location_precision: precision,
          captured_at: hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : null,
          visibility: "public", comments_allowed: "everyone", media,
        }),
      });
      const j = await res.json().catch(() => null);
      if (res.status === 409) throw Object.assign(new Error("Set up your traveler profile first."), { needsProfile: true });
      if (!res.ok) throw new Error(j?.error ?? "Couldn't publish. Please try again.");
      onPosted(); onClose();
    } catch (e) {
      const err = e as Error & { needsProfile?: boolean };
      setError({ message: err.message || "Something went wrong. Please try again.", needsProfile: err.needsProfile });
      setPhase("form");                                                      // everything typed is still here; finished uploads are kept
    }
  }

  return (
    <Sheet title="Share a destination" onClose={phase === "uploading" ? () => undefined : onClose}>
      <div className="space-y-4 p-4">
        {!hasProfile && (
          <p className="rounded-xl bg-marigold-light px-3 py-2 text-sm text-[#7a4a00]">
            Set up your traveler profile (a username) before sharing. <Link href="/profile" className="font-semibold underline">Open profile</Link>
          </p>
        )}

        <div>
          <input ref={input} id="composer-files" type="file" accept="image/*,video/mp4,video/webm" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} />
          <label htmlFor="composer-files" className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-teal/50 text-sm font-semibold text-teal-ink hover:bg-teal-light">
            <CameraIcon size={26} />Add photos or a short video
            <span className="text-xs font-normal text-ink-muted">Up to {MEDIA_LIMITS.mediaPerPost} photos, or one video up to {MEDIA_LIMITS.videoSeconds}s. No media? Share a written condition report.</span>
          </label>
          {items.length > 0 && (
            <ul className="mt-3 grid grid-cols-4 gap-2">
              {items.map((it) => (
                <li key={it.id} className="relative aspect-square overflow-hidden rounded-xl bg-sky">
                  {it.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img src={it.preview} alt="" className="h-full w-full object-cover" />
                  )}
                  {it.status === "preparing" && <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-muted">Preparing…</span>}
                  {it.status === "error" && <span className="absolute inset-0 flex items-center justify-center bg-clay-light p-1 text-center text-[10px] leading-tight text-clay-ink">{it.error}</span>}
                  <button type="button" onClick={() => remove(it.id)} aria-label={`Remove ${it.name}`} disabled={phase === "uploading"} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"><CloseIcon size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-muted">Photos are re-saved without location or camera details, and GPS is removed from videos, before anything is uploaded.</p>
        </div>

        <PlaceSearch label="Which destination is this?" hint="Search the place so it lands on the right destination and map." placeholder="e.g. Matheran" value={dest} onChange={setDest} />

        <div>
          <label htmlFor="composer-spot" className="block text-sm font-semibold">Which spot? <span className="font-normal text-ink-muted">(optional)</span></label>
          <input id="composer-spot" value={spot} onChange={(e) => setSpot(e.target.value)} maxLength={120} placeholder="e.g. Echo Point" className="mt-1.5 min-h-11 w-full rounded-xl border border-line px-3.5 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40" />
        </div>

        <div>
          <label htmlFor="composer-caption" className="block text-sm font-semibold">{items.length === 0 ? "What are you seeing right now?" : "Caption"}</label>
          <textarea id="composer-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} rows={3}
            placeholder={items.length === 0 ? "Road is clear, light rain, parking full by 10…" : "Tell people what it looks like and when to go"}
            className="mt-1.5 w-full rounded-xl border border-line px-3.5 py-2.5 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="composer-when" className="block text-sm font-semibold">When was this?</label>
            <select id="composer-when" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base">
              {WHEN.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-muted">Older posts are labelled honestly, so nobody mistakes them for today&apos;s conditions.</p>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold">Location shown</legend>
            <div className="mt-1.5 space-y-1.5 text-sm">
              {([["approx", "Approximate area (about 1 km)"], ["exact", "Exact spot"]] as const).map(([v, label]) => (
                <label key={v} className="flex min-h-9 items-center gap-2"><input type="radio" name="precision" checked={precision === v} onChange={() => setPrecision(v)} className="h-4 w-4 accent-[#1c7c6d]" />{label}</label>
              ))}
            </div>
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">
            {error.message} {error.needsProfile && <Link href="/profile" className="font-semibold underline">Open profile</Link>}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          {phase === "uploading" && <span aria-live="polite" className="text-sm text-ink-muted">{progress}</span>}
          <Button onClick={() => void submit()} disabled={!canPost}>{phase === "uploading" ? "Publishing…" : error ? "Try again" : "Share"}</Button>
        </div>
      </div>
    </Sheet>
  );
}
