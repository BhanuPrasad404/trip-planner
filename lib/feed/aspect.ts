// How tall a post's picture is drawn. The real shape of the photo, kept inside limits so one very tall or very wide picture
// never takes over the screen (or leaves a sliver). Pure, so the same rule serves the feed and the post page.
import type { MediaDTO } from "./map";

export const CARD_RATIO = { min: 0.8, max: 1.6, fallback: 0.8 } as const;     // width ÷ height: 4:5 (tall) … 16:10 (wide)
export const PAGE_RATIO = { min: 0.56, max: 1.91, fallback: 1 } as const;

export function ratioOf(media: Pick<MediaDTO, "width" | "height"> | undefined, limits: { min: number; max: number; fallback: number }): number {
  const w = media?.width, h = media?.height;
  if (!w || !h || w <= 0 || h <= 0) return limits.fallback;
  return Math.min(limits.max, Math.max(limits.min, w / h));
}
