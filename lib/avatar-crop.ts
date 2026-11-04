// The maths of the profile-picture editor: which square of the photo ends up in the circle. Pure, so it is tested without a screen.
//   zoom 1 = the photo just covers the square (its shorter side fills it); higher zooms in.
//   (cx, cy) = the centre of the square on the photo, as a fraction of its width / height (0.5, 0.5 = the middle).
export const MAX_ZOOM = 4;

export type Crop = { zoom: number; cx: number; cy: number };
export type Rect = { sx: number; sy: number; side: number };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The square of the photo, in the photo's own pixels, that the crop selects. Always inside the photo. */
export function cropRect(imgW: number, imgH: number, crop: Crop): Rect {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const side = Math.min(imgW, imgH) / zoom;
  const sx = clamp(crop.cx * imgW - side / 2, 0, imgW - side);
  const sy = clamp(crop.cy * imgH - side / 2, 0, imgH - side);
  return { sx, sy, side };
}

/** Keeps the centre where the square can still be fully inside the photo, whatever the zoom. */
export function clampCrop(imgW: number, imgH: number, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const side = Math.min(imgW, imgH) / zoom;
  const halfX = side / 2 / imgW, halfY = side / 2 / imgH;
  return { zoom, cx: clamp(crop.cx, halfX, 1 - halfX), cy: clamp(crop.cy, halfY, 1 - halfY) };
}

/** Dragging by (dx, dy) screen pixels across a square viewport of `view` pixels moves the picture with the finger. */
export function dragCrop(imgW: number, imgH: number, crop: Crop, dx: number, dy: number, view: number): Crop {
  const { side } = cropRect(imgW, imgH, crop);
  const perPx = side / view;                         // photo pixels per screen pixel
  return clampCrop(imgW, imgH, { zoom: crop.zoom, cx: crop.cx - (dx * perPx) / imgW, cy: crop.cy - (dy * perPx) / imgH });
}
