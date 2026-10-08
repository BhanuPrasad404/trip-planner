"use client";

import { useRef } from "react";
import { canAddMore } from "@/lib/feed/compose";
import { MEDIA_LIMITS } from "@/lib/social/media";
import { CameraIcon, CloseIcon, PenIcon, PlusIcon, ShieldIcon, StarIcon, UploadIcon } from "../icons";
import type { CameraSupport } from "@/lib/client/camera-support";
import type { CameraMode } from "@/lib/client/recorder";
import type { ComposerItem } from "./types";

type Props = {
  items: ComposerItem[];
  dragging: boolean;
  busy: boolean;
  onFiles: (files: FileList | File[] | null) => void;
  onRemove: (id: string) => void;
  onMakeCover: (id: string) => void;
  onWrittenOnly: () => void;
  cameraSupport: CameraSupport;
  onCamera: (mode: CameraMode) => void;
};

export function MediaStep({ items, dragging, busy, onFiles, onRemove, onMakeCover, onWrittenOnly, cameraSupport, onCamera }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const hasVideo = items.some((i) => i.media?.type === "video");

  return (
    <div className="tm-rise space-y-5">
      <input ref={picker} type="file" accept="image/*,video/mp4,video/webm" multiple className="sr-only" aria-label="Choose photos or a video" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />

      {items.length === 0 ? (
        <div className={`flex min-h-[320px] flex-col items-center justify-center gap-5 rounded-[28px] border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-teal bg-teal-light" : "border-teal/35 bg-gradient-to-b from-teal-light/70 to-white"}`}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-teal shadow-md ring-1 ring-teal/15"><UploadIcon size={28} /></span>
          <div>
            <p className="font-display text-2xl font-semibold text-pine">Show what it looks like</p>
            <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-muted">{dragging ? "Drop to add" : "Drag photos or a short video here, or pick them from your device."}</p>
          </div>
          <div className="grid w-full max-w-md gap-2.5 sm:grid-cols-3">
            {cameraSupport.photo ? (
              <button type="button" onClick={() => onCamera("photo")} className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-teal px-3 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform"><CameraIcon size={24} />Take photo</button>
            ) : (
              <button type="button" onClick={() => camera.current?.click()} className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-teal px-3 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform md:hidden"><CameraIcon size={24} />Take photo</button>
            )}
            {cameraSupport.video && (
              <button type="button" onClick={() => onCamera("video")} className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl bg-red-500 px-3 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white"><span className="h-2.5 w-2.5 rounded-full bg-white" /></span>Record video
              </button>
            )}
            <button type="button" onClick={() => picker.current?.click()} className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-2xl border border-teal/40 bg-white px-3 text-sm font-semibold text-teal-ink active:scale-95 transition-transform ${cameraSupport.photo || cameraSupport.video ? "" : "sm:col-span-3"}`}><PlusIcon size={22} />Upload from device</button>
          </div>
          <p className="text-xs text-ink-muted">Up to {MEDIA_LIMITS.mediaPerPost} photos, or one video up to {MEDIA_LIMITS.videoSeconds} seconds — recorded or uploaded</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-pine">{hasVideo ? "Your video" : `${items.length} of ${MEDIA_LIMITS.mediaPerPost} photos`}</p>
            {!hasVideo && items.length > 1 && <p className="text-xs text-ink-muted">The ★ photo is the cover</p>}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((it, i) => (
              <li key={it.id} className="tm-pop relative aspect-[4/5] overflow-hidden rounded-2xl bg-sky ring-1 ring-line">
                {it.preview && (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={it.preview} alt={`Preview of ${it.name}`} className="h-full w-full object-cover" />
                )}
                {it.status === "preparing" && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 text-xs font-semibold text-ink-muted backdrop-blur-sm" role="status">
                    <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-teal/25 border-t-teal" />Preparing…
                  </span>
                )}
                {it.status === "error" && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-clay-light p-3 text-center text-xs font-medium leading-snug text-clay-ink" role="alert">
                    <strong>Couldn&apos;t use this file</strong>{it.error}
                  </span>
                )}
                {it.media?.type === "video" && <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">Video · {Math.round(it.media.durationS ?? 0)}s</span>}
                {i === 0 && items.length > 1 && it.status === "ready" && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-marigold px-2 py-0.5 text-[11px] font-semibold text-pine"><StarIcon size={12} filled />Cover</span>}
                <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5">
                  <button type="button" onClick={() => onRemove(it.id)} disabled={busy} aria-label={`Remove ${it.name}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur disabled:opacity-50"><CloseIcon size={16} /></button>
                  {i > 0 && it.status === "ready" && <button type="button" onClick={() => onMakeCover(it.id)} disabled={busy} aria-label={`Make ${it.name} the cover`} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur disabled:opacity-50"><StarIcon size={16} /></button>}
                </div>
              </li>
            ))}
            {canAddMore(items.map((i) => ({ status: i.status, type: i.media?.type }))) && (
              <li>
                <button type="button" onClick={() => picker.current?.click()} className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-teal/40 bg-teal-light/40 text-sm font-semibold text-teal-ink hover:bg-teal-light active:scale-95 transition-transform">
                  <PlusIcon size={24} />Add more
                </button>
              </li>
            )}
          </ul>
        </>
      )}

      <div className="flex items-start gap-2.5 rounded-2xl bg-sky/70 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
        <ShieldIcon size={18} className="mt-0.5 shrink-0 text-teal" />
        <p><strong className="text-pine">Your location stays private.</strong> Photos are re-saved without camera details or GPS, and GPS is removed from videos, before anything leaves your device.</p>
      </div>

      {items.length === 0 && (
        <button type="button" onClick={onWrittenOnly} className="mx-auto flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-ink underline underline-offset-4">
          <PenIcon size={16} />No photo? Share a written condition report instead
        </button>
      )}
    </div>
  );
}
