// When should the bottom navigation get out of the way? The rule, in one pure function:
//   • scrolling DOWN far enough (and not near the top) hides it; scrolling UP a little brings it back;
//   • at the top of the page, or when the page barely scrolls, it is always there;
//   • tiny movements, jitter and the rubber-band bounce at the ends never toggle it (hysteresis: it takes a real, sustained movement).
export type ScrollState = { y: number; hidden: boolean; /** Where the current direction of travel began. */ anchor: number; dir: -1 | 0 | 1 };
export type ScrollConfig = {
  /** At or above this scroll position the bar is always shown. */
  topPx: number;
  /** The page must be scrolled at least this far before the bar may hide. */
  hideAfterPx: number;
  /** Sustained downward travel needed to hide. */
  downPx: number;
  /** Sustained upward travel needed to show again. */
  upPx: number;
  /** The most the page can scroll (document height - window height). A page that barely scrolls never hides the bar. */
  maxY: number | null;
  /** Below this much scrollable distance the page is "not scrollable" and the bar stays. */
  minScrollablePx: number;
};

export const SCROLL_DEFAULTS: ScrollConfig = { topPx: 24, hideAfterPx: 96, downPx: 16, upPx: 8, maxY: null, minScrollablePx: 96 };
export const initialScroll = (y = 0): ScrollState => ({ y, hidden: false, anchor: y, dir: 0 });

export function stepScroll(prev: ScrollState, rawY: number, cfg: ScrollConfig = SCROLL_DEFAULTS): ScrollState {
  if (!Number.isFinite(rawY)) return prev;
  // Overscroll (the bounce past either end on phones) is not a direction: clamp it away.
  const y = Math.max(0, cfg.maxY !== null ? Math.min(rawY, cfg.maxY) : rawY);
  if (cfg.maxY !== null && cfg.maxY < cfg.minScrollablePx) return { y, hidden: false, anchor: y, dir: 0 };
  if (y <= cfg.topPx) return { y, hidden: false, anchor: y, dir: 0 };
  const delta = y - prev.y;
  if (delta === 0) return prev;
  const dir: -1 | 1 = delta > 0 ? 1 : -1;
  const anchor = dir === prev.dir ? prev.anchor : prev.y; // a change of direction starts counting from where it changed
  let hidden = prev.hidden;
  if (dir === 1 && y - anchor >= cfg.downPx && y > cfg.hideAfterPx) hidden = true;
  else if (dir === -1 && anchor - y >= cfg.upPx) hidden = false;
  return { y, hidden, anchor, dir };
}
