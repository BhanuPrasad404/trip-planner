// The "you are here" puck: blue dot, white ring, a pulsing aura and a heading fan. Plain DOM (it is a map Marker) so it can
// be moved every animation frame without touching React.
const NS = "http://www.w3.org/2000/svg";

export function createPuck(): { el: HTMLDivElement; setAccurate: (ok: boolean) => void; setHeadingKnown: (known: boolean) => void } {
  const el = document.createElement("div");
  el.className = "tm-puck";
  el.setAttribute("aria-label", "You are here");
  const ring = document.createElement("span");
  ring.className = "tm-puck-ring";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "tm-puck-fan");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  const fan = document.createElementNS(NS, "path");
  fan.setAttribute("d", "M32 32 L8 4 A40 40 0 0 1 56 4 Z"); // a cone opening forward (up) from the dot
  fan.setAttribute("fill", "url(#tm-fan)");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = '<linearGradient id="tm-fan" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1a73e8" stop-opacity="0.55"/><stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></linearGradient>';
  svg.append(defs, fan);
  const dot = document.createElement("span");
  dot.className = "tm-puck-dot";
  el.append(ring, svg, dot);
  return { el, setAccurate: (ok) => el.classList.toggle("tm-puck-vague", !ok), setHeadingKnown: (known: boolean) => el.classList.toggle("tm-puck-nohead", !known) };
}
