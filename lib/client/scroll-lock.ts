// Keeps the page behind an open sheet from scrolling (a phone would otherwise scroll the feed under your finger).
// Counted, so two sheets open at once (a menu over a comment box) unlock only when the last one closes.
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  if (locks === 0) {
    saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    const bar = window.innerWidth - root.clientWidth;                    // desktop scrollbar width: keep the layout from jumping sideways
    root.style.overflow = "hidden";
    if (bar > 0) root.style.paddingRight = `${bar}px`;
  }
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0 && saved) { root.style.overflow = saved.overflow; root.style.paddingRight = saved.paddingRight; saved = null; }
  };
}
