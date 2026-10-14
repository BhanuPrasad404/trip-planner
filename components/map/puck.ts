// The "you are here" puck: a blue marker with a white ring, a pulsing aura and a heading fan. Plain DOM (it is a map Marker) so it can
// be moved every animation frame without touching React. It is drawn as a small top-down car, motorcycle or bus (pointing the way the road
// points), so the traveller sees their own vehicle. It moves only when real GPS readings move it (see lib/map/nav-camera).
import { DEFAULT_VEHICLE, type Vehicle } from "@/lib/vehicle";

const NS = "http://www.w3.org/2000/svg";

type Shape = { tag: "rect" | "circle" | "path"; attrs: Record<string, string> };

/** Top-down silhouettes in a 32x32 box, pointing up (north = the way you are heading). "body" parts take the puck colour, "detail" parts are white. */
export const VEHICLE_SHAPES: Record<Vehicle, { part: "body" | "detail"; shape: Shape }[]> = {
  car: [
    { part: "body", shape: { tag: "rect", attrs: { x: "9", y: "3", width: "14", height: "26", rx: "6" } } },
    { part: "detail", shape: { tag: "path", attrs: { d: "M11.2 10h9.6l-1.6 5h-6.4z" } } },
    { part: "detail", shape: { tag: "rect", attrs: { x: "11.5", y: "21", width: "9", height: "4", rx: "1" } } },
  ],
  motorcycle: [
    { part: "body", shape: { tag: "rect", attrs: { x: "13.6", y: "3", width: "4.8", height: "26", rx: "2.4" } } },
    { part: "body", shape: { tag: "rect", attrs: { x: "7.5", y: "9", width: "17", height: "2.6", rx: "1.3" } } },
    { part: "detail", shape: { tag: "circle", attrs: { cx: "16", cy: "17", r: "3.4" } } },
  ],
  bus: [
    { part: "body", shape: { tag: "rect", attrs: { x: "9.5", y: "2", width: "13", height: "28", rx: "3" } } },
    { part: "detail", shape: { tag: "rect", attrs: { x: "11.5", y: "4.5", width: "9", height: "3.2", rx: "0.8" } } },
    { part: "detail", shape: { tag: "rect", attrs: { x: "11.5", y: "11", width: "9", height: "2.6", rx: "0.8" } } },
    { part: "detail", shape: { tag: "rect", attrs: { x: "11.5", y: "16", width: "9", height: "2.6", rx: "0.8" } } },
    { part: "detail", shape: { tag: "rect", attrs: { x: "11.5", y: "21", width: "9", height: "2.6", rx: "0.8" } } },
  ],
};

function drawVehicle(svg: SVGElement, v: Vehicle) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (const { part, shape } of VEHICLE_SHAPES[v]) {
    const el = document.createElementNS(NS, shape.tag);
    for (const [k, val] of Object.entries(shape.attrs)) el.setAttribute(k, val);
    el.setAttribute("class", part === "body" ? "tm-veh-body" : "tm-veh-detail");
    svg.appendChild(el);
  }
}

export function createPuck(vehicle: Vehicle = DEFAULT_VEHICLE): { el: HTMLDivElement; setAccurate: (ok: boolean) => void; setHeadingKnown: (known: boolean) => void; setVehicle: (v: Vehicle) => void } {
  const el = document.createElement("div");
  el.className = "tm-puck tm-puck-vehicular";
  const ring = document.createElement("span");
  ring.className = "tm-puck-ring";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "tm-puck-fan");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  const fan = document.createElementNS(NS, "path");
  fan.setAttribute("d", "M32 32 L8 4 A40 40 0 0 1 56 4 Z"); // a cone opening forward (up) from the marker
  fan.setAttribute("fill", "url(#tm-fan)");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = '<linearGradient id="tm-fan" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1a73e8" stop-opacity="0.55"/><stop offset="1" stop-color="#1a73e8" stop-opacity="0"/></linearGradient>';
  svg.append(defs, fan);
  const dot = document.createElement("span");
  dot.className = "tm-puck-dot";
  const veh = document.createElementNS(NS, "svg");
  veh.setAttribute("class", "tm-puck-vehicle");
  veh.setAttribute("viewBox", "0 0 32 32");
  veh.setAttribute("aria-hidden", "true");
  drawVehicle(veh, vehicle);
  el.setAttribute("role", "img");
  const label = (v: Vehicle) => `You are here, in your ${v === "motorcycle" ? "motorcycle" : v}`;
  el.setAttribute("aria-label", label(vehicle));
  el.append(ring, svg, dot, veh);
  return {
    el,
    setAccurate: (ok) => el.classList.toggle("tm-puck-vague", !ok),
    setHeadingKnown: (known: boolean) => el.classList.toggle("tm-puck-nohead", !known),
    setVehicle: (v: Vehicle) => { drawVehicle(veh, v); el.setAttribute("aria-label", label(v)); },
  };
}
