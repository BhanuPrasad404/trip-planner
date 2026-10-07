// Builds the little round icon badge used on the MapLibre map (plain DOM, no React).
import { GLYPHS, KIND_GLYPH, TONES } from "@/lib/glyphs";

const NS = "http://www.w3.org/2000/svg";

export function markerIcon(kind: string, px: number, highlight: boolean): HTMLDivElement {
  const entry = KIND_GLYPH[kind] ?? { glyph: "pin" as const, tone: "pine" as const };
  const tone = TONES[entry.tone];
  const el = document.createElement("div");
  el.style.cssText = [
    `width:${px}px`, `height:${px}px`, "border-radius:50%", `background:${tone.bg}`, `border:2px solid ${highlight ? "#C1542C" : "#fff"}`,
    "display:flex", "align-items:center", "justify-content:center", "box-shadow:0 1px 4px rgba(0,0,0,.4)", "cursor:pointer",
    `z-index:${highlight ? 5 : 1}`,
  ].join(";");
  const svg = document.createElementNS(NS, "svg");
  const inner = Math.round(px * 0.56);
  for (const [k, v] of Object.entries({ width: inner, height: inner, viewBox: "0 0 24 24", fill: "none", stroke: tone.fg, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of GLYPHS[entry.glyph]) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
  }
  el.appendChild(svg);
  return el;
}
