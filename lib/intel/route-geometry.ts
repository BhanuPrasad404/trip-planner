// Geometry on a driving route: where along the road is a point, and how far off the road is it?
// Works on short segments with a local flat-earth approximation, which is accurate to centimetres at road scale.
import { haversineM, type GeoPoint } from "@/lib/geo";
import type { LngLat } from "@/lib/poi/types";

export type RouteIndex = {
  pts: LngLat[];
  /** cumulative distance in metres at each vertex; cum[0] = 0 */
  cum: number[];
  totalM: number;
};

export { haversineM };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function buildRoute(line: LngLat[]): RouteIndex {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + haversineM({ lat: line[i - 1][1], lng: line[i - 1][0] }, { lat: line[i][1], lng: line[i][0] }));
  }
  return { pts: line, cum, totalM: cum[cum.length - 1] ?? 0 };
}

export type Projection = {
  alongM: number;
  offsetM: number;
  segment: number;
  /** The point is really BEFORE the start of the route (it only snaps to the start vertex). */
  behindStart: boolean;
  /** The point is really PAST the end of the route. */
  pastEnd: boolean;
};

/** Nearest point on the route to `p`: how far along the road it is and how far to the side. */
export function project(route: RouteIndex, p: GeoPoint): Projection {
  if (route.pts.length === 0) return { alongM: 0, offsetM: Infinity, segment: 0, behindStart: false, pastEnd: false };
  if (route.pts.length === 1) return { alongM: 0, offsetM: haversineM(p, { lat: route.pts[0][1], lng: route.pts[0][0] }), segment: 0, behindStart: false, pastEnd: false };
  const cosLat = Math.cos(rad(p.lat));
  let best: Projection = { alongM: 0, offsetM: Infinity, segment: 0, behindStart: false, pastEnd: false };
  for (let i = 0; i < route.pts.length - 1; i++) {
    const [ax, ay] = route.pts[i];
    const [bx, by] = route.pts[i + 1];
    // metres in a local frame centred on p
    const x1 = rad(ax - p.lng) * R * cosLat, y1 = rad(ay - p.lat) * R;
    const x2 = rad(bx - p.lng) * R * cosLat, y2 = rad(by - p.lat) * R;
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const rawT = len2 === 0 ? 0 : (-x1 * dx - y1 * dy) / len2;
    const t = Math.max(0, Math.min(1, rawT));
    const px = x1 + t * dx, py = y1 + t * dy;
    const off = Math.hypot(px, py);
    if (off < best.offsetM) {
      best = {
        alongM: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]),
        offsetM: off,
        segment: i,
        behindStart: i === 0 && rawT < 0,
        pastEnd: i === route.pts.length - 2 && rawT > 1,
      };
    }
  }
  return best;
}

/** The point `alongM` metres from the start of the route (clamped). */
export function pointAt(route: RouteIndex, alongM: number): GeoPoint {
  if (route.pts.length === 0) return { lat: 0, lng: 0 };
  const d = Math.max(0, Math.min(route.totalM, alongM));
  let i = 0;
  while (i < route.cum.length - 2 && route.cum[i + 1] < d) i++;
  const segLen = route.cum[i + 1] - route.cum[i];
  const f = segLen > 0 ? (d - route.cum[i]) / segLen : 0;
  const [ax, ay] = route.pts[i];
  const [bx, by] = route.pts[Math.min(i + 1, route.pts.length - 1)];
  return { lng: ax + (bx - ax) * f, lat: ay + (by - ay) * f };
}

/** The first `maxM` metres of a route (the part worth mapping/searching). */
export function trimLine(line: LngLat[], maxM: number): LngLat[] {
  const r = buildRoute(line);
  if (r.totalM <= maxM) return line;
  const out: LngLat[] = [];
  for (let i = 0; i < line.length && r.cum[i] <= maxM; i++) out.push(line[i]);
  const end = pointAt(r, maxM);
  out.push([end.lng, end.lat]);
  return out;
}
