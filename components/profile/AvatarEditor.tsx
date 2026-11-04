"use client";

// Choose which part of a photo becomes the profile picture: drag to move, zoom to fit, see exactly the circle other people will see.
// The result is made HERE, on the phone: a 512 px square, WebP (JPEG where the phone cannot make WebP) under 512 KB, so a 12 MB camera photo
// is never uploaded. Nothing leaves the phone until the person taps "Use this photo".
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PickerSheet } from "@/components/ui/Sheet";
import { AVATAR_MAX_BYTES, AVATAR_SIZE } from "@/lib/avatar";
import { MAX_ZOOM, clampCrop, cropRect, dragCrop, type Crop } from "@/lib/avatar-crop";

export type AvatarResult = { blob: Blob; ext: "webp" | "jpg" };
const VIEW = 272;

/** Draws the chosen square of the photo into a 512 px canvas and encodes it small enough. Null when the browser cannot encode an image. */
export async function renderAvatar(bitmap: ImageBitmap, crop: Crop): Promise<AvatarResult | null> {
  const { sx, sy, side } = cropRect(bitmap.width, bitmap.height, crop);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  for (const q of [0.86, 0.72, 0.58, 0.45]) {
    const webp = await encode("image/webp", q);
    if (webp && webp.type === "image/webp") { if (webp.size <= AVATAR_MAX_BYTES) return { blob: webp, ext: "webp" }; continue; }
    const jpg = await encode("image/jpeg", q);                       // some phones cannot make WebP: they silently return PNG, so ask for JPEG
    if (jpg && jpg.type === "image/jpeg" && jpg.size <= AVATAR_MAX_BYTES) return { blob: jpg, ext: "jpg" };
  }
  return null;
}

export function AvatarEditor({ file, onDone, onCancel }: { file: File; onDone: (r: AvatarResult) => void | Promise<void>; onCancel: () => void }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>({ zoom: 1, cx: 0.5, cy: 0.5 });
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
      .then((b) => { if (!cancelled) setBitmap(b); })
      .catch(() => { if (!cancelled) setProblem("We couldn't open that photo. Try a JPEG or PNG."); });
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !bitmap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(VIEW * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { sx, sy, side } = cropRect(bitmap.width, bitmap.height, crop);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, c.width, c.height);
  }, [bitmap, crop]);

  const move = useCallback((dx: number, dy: number) => { if (bitmap) setCrop((c) => dragCrop(bitmap.width, bitmap.height, c, dx, dy, VIEW)); }, [bitmap]);
  const zoom = useCallback((z: number) => { if (bitmap) setCrop((c) => clampCrop(bitmap.width, bitmap.height, { ...c, zoom: z })); }, [bitmap]);

  async function use() {
    if (!bitmap) return;
    setBusy(true); setProblem(null);
    try {
      const r = await renderAvatar(bitmap, crop);
      if (!r) { setProblem("This browser couldn't prepare the picture. Please try another browser or a smaller photo."); return; }
      await onDone(r);
    } finally { setBusy(false); }
  }

  return (
    <PickerSheet title="Your profile picture" onClose={onCancel} footer={
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button className="min-h-12 w-full sm:flex-1" onClick={() => void use()} disabled={!bitmap} loading={busy} loadingLabel="Saving…">Use this photo</Button>
        <Button variant="secondary" className="min-h-12 w-full sm:flex-1" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    }>
      <div className="flex flex-col items-center gap-4 px-4 py-5">
        <div
          role="img" aria-label="Your picture. Drag to move it, or use the arrow keys." tabIndex={0}
          style={{ width: VIEW, height: VIEW, touchAction: "none" }}
          className="relative cursor-grab overflow-hidden rounded-full bg-sky ring-4 ring-white shadow-float active:cursor-grabbing"
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerMove={(e) => { if (!drag.current) return; move(e.clientX - drag.current.x, e.clientY - drag.current.y); drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onWheel={(e) => zoom(crop.zoom - e.deltaY * 0.002)}
          onKeyDown={(e) => {
            const k = e.key, step = 12;
            if (k === "ArrowLeft") { e.preventDefault(); move(step, 0); } else if (k === "ArrowRight") { e.preventDefault(); move(-step, 0); }
            else if (k === "ArrowUp") { e.preventDefault(); move(0, step); } else if (k === "ArrowDown") { e.preventDefault(); move(0, -step); }
            else if (k === "+" || k === "=") zoom(crop.zoom + 0.2); else if (k === "-") zoom(crop.zoom - 0.2);
          }}
        >
          <canvas ref={canvas} style={{ width: VIEW, height: VIEW }} className="block" />
          {!bitmap && !problem && <span className="absolute inset-0 animate-pulse bg-sky motion-reduce:animate-none" />}
        </div>
        <label className="flex w-full max-w-xs items-center gap-3 text-sm font-semibold text-pine">
          <span className="shrink-0">Zoom</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={(e) => zoom(Number(e.target.value))} disabled={!bitmap} className="tm-range w-full" aria-label="Zoom" />
        </label>
        <p className="max-w-xs text-center text-xs text-ink-muted">Drag the photo to choose the part people will see. It is made small and square on your phone; the original isn&apos;t uploaded.</p>
        {problem && <p role="alert" className="max-w-xs text-center text-sm font-semibold text-clay-ink">{problem}</p>}
      </div>
    </PickerSheet>
  );
}
