"use client";

import { useRef } from "react";
import { canAddMore } from "@/lib/feed/compose";
import { MEDIA_LIMITS } from "@/lib/social/media";
import { Spinner } from "@/components/ui/Spinner";
import { CloseIcon, PenIcon, PlusIcon, ShieldIcon, StarIcon } from "../icons";
import { Glyph } from "@/components/ui/Glyph";
import type { GlyphName } from "@/lib/glyphs";
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
        <div className="space-y-4">
          {/* The drop zone: a small stack of postcards with an upload badge (drawn, not a stock picture) */}
          <div className={`flex flex-col items-center gap-3 rounded-[2rem] border-2 border-dashed px-5 py-8 text-center transition-colors ${dragging ? "border-teal bg-teal-light" : "border-teal/35 bg-white/70"}`}>
            <div aria-hidden="true" className="relative h-28 w-44">
              <svg viewBox="0 0 176 112" className="h-full w-full">
                <rect x="30" y="14" width="104" height="78" rx="12" transform="rotate(8 82 53)" fill="var(--teal-light)" />
                <g transform="rotate(-6 80 56)">
                  <rect x="22" y="10" width="104" height="80" rx="12" fill="#fff" stroke="var(--line)" />
                  <rect x="30" y="18" width="88" height="64" rx="8" fill="var(--marigold-light)" />
                  <circle cx="98" cy="36" r="8" fill="var(--marigold)" />
                  <path d="M30 82V58c14-14 26-10 38 2 12-18 28-16 50 4v18z" fill="var(--teal)" opacity="0.8" />
                  <path d="M30 82V68c18-8 32-4 44 4 14-8 28-6 44 2v8z" fill="var(--pine)" />
                </g>
              </svg>
              <span className="absolute -bottom-1 right-2 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-teal to-pine text-white shadow-float ring-4 ring-white"><Glyph name="arrowUp" size={26} strokeWidth={2.6} /></span>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold text-pine">Add photos or a video</p>
              <p className="mt-1 text-sm text-ink-muted">{dragging ? "Drop to add" : "Drag & drop, or choose from below"}</p>
            </div>
          </div>

          <ul className="space-y-3">
            {cameraSupport.photo
              ? <Option glyph="camera" tone="pine" title="Take a photo" hint="Capture the moment directly." onClick={() => onCamera("photo")} />
              : <Option glyph="camera" tone="pine" title="Take a photo" hint="Capture the moment directly." onClick={() => camera.current?.click()} />}
            {cameraSupport.video && <Option glyph="video" tone="mint" title="Record a video" hint={`Share up to ${MEDIA_LIMITS.videoSeconds} seconds.`} onClick={() => onCamera("video")} />}
            <Option glyph="gallery" tone="sun" title="Choose from gallery" hint="Upload existing travel memories." onClick={() => picker.current?.click()} />
          </ul>
          {!cameraSupport.photo && cameraSupport.why && (
            <p role="note" className="text-xs leading-relaxed text-ink-muted">
              {cameraSupport.why === "insecure" ? "The in-app camera needs a secure (https) page, so it is off here." : "This browser doesn't offer in-app camera access."} Use <strong>Choose from gallery</strong>{" "}to add a photo or video you already have.
            </p>
          )}
          <p className="text-center text-xs text-ink-muted">Up to {MEDIA_LIMITS.mediaPerPost} photos, or one video up to {MEDIA_LIMITS.videoSeconds} seconds — recorded or uploaded</p>
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
                    <Spinner size={28} className="text-teal" />Preparing…
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

      <div className="flex items-center gap-3.5 rounded-3xl border border-teal/20 bg-gradient-to-r from-teal-light to-white px-4 py-3.5 text-sm leading-snug text-ink-muted">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-teal shadow-card ring-1 ring-teal/20"><ShieldIcon size={22} /></span>
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

const TILE = { pine: "bg-gradient-to-br from-teal to-pine text-white", mint: "bg-teal-light text-teal-ink", sun: "bg-marigold-light text-marigold-ink" } as const;
/** One way to add media: a big colour tile, a title and a hint, and a chevron. */
function Option({ glyph, tone, title, hint, onClick }: { glyph: GlyphName; tone: keyof typeof TILE; title: string; hint: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="group flex min-h-[4.75rem] w-full items-center gap-4 rounded-3xl border border-line bg-white p-3 text-left shadow-card transition active:scale-[0.985] hover:border-teal/40">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${TILE[tone]}`}><Glyph name={glyph} size={26} /></span>
        <span className="min-w-0 flex-1"><span className="block text-base font-semibold text-pine">{title}</span><span className="block text-sm text-ink-muted">{hint}</span></span>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky text-pine transition group-hover:bg-teal-light"><Glyph name="chevronRight" size={18} /></span>
      </button>
    </li>
  );
}
