// "What am I about to meet?" — one ordered list of what lies ahead on the day's drive, built from the same facts the rest of the
// engine uses: arrival windows (feasibility), the terrain along the actual road, and the forecast at each stop. Nothing here is
// invented: a terrain item exists only if elevation data showed it, a weather item only for a real FORECAST that calls for advice,
// and every item says how sure it is (an estimate, a published fact, a forecast). Times for terrain are interpolated along the road
// between the stops' own arrival times, so time spent at a stop correctly delays what comes after it.
import { clockOf, dayShiftLabel, localizeClocks } from "./clock";
import type { StopVerdict, Verdict } from "./feasibility";
import type { TerrainSegment } from "./terrain";
import type { WeatherVisual } from "./weather-visual";

export type TimelineKind = "depart" | "stop" | "terrain" | "weather" | "end";
export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  atMs: number | null;
  atClock: string | null;
  dayShift: string | null;
  /** Minutes after leaving, when known. */
  afterMin: number | null;
  title: string;
  detail: string;
  tone: Verdict;
  /** What kind of information this is, so estimates are never shown as facts. */
  basis: "estimate" | "published" | "forecast" | "terrain-model" | "plan";
  /** True when the time is an approximation (terrain timing is interpolated). */
  approximate: boolean;
};

export type TimelineStop = { id: string; name: string; lat: number; lng: number; visitMin: number };

const MIN = 60_000;

/** Distance along a [lng, lat] line to the point on it nearest `p`. */
export function kmAlongLine(line: [number, number][], p: { lat: number; lng: number }): number | null {
  if (line.length < 2) return null;
  const rad = Math.PI / 180;
  const hav = (a: [number, number], b: [number, number]) => { const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
  let cum = 0, best = Infinity, bestKm = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) cum += hav(line[i - 1], line[i]);
    const d = hav(line[i], [p.lng, p.lat]);
    if (d < best) { best = d; bestKm = cum; }
  }
  return best <= 5 ? bestKm : null; // a stop more than 5 km from the road line is not "on" it: do not pretend
}

export function buildTimeline(a: {
  departureMs: number;
  utcOffsetMin: number;
  stops: TimelineStop[];
  verdicts: StopVerdict[];
  line?: [number, number][] | null;
  terrain?: TerrainSegment[] | null;
  weather?: Record<string, WeatherVisual | null | undefined>;
}): TimelineItem[] {
  const off = a.utcOffsetMin;
  const mk = (id: string, kind: TimelineKind, atMs: number | null, title: string, detail: string, tone: Verdict, basis: TimelineItem["basis"], approximate = false): TimelineItem => ({
    id, kind, atMs, atClock: atMs === null ? null : clockOf(atMs, off), dayShift: atMs === null ? null : dayShiftLabel(a.departureMs, atMs, off), afterMin: atMs === null ? null : Math.round((atMs - a.departureMs) / MIN), title, detail, tone, basis, approximate,
  });

  const items: TimelineItem[] = [mk("depart", "depart", a.departureMs, "You leave", "The time you chose.", "ok", "plan")];

  // Stops, with the weather forecast at each (only a real forecast that calls for advice).
  a.verdicts.forEach((v, i) => {
    items.push(mk(`stop:${v.stopId}`, "stop", v.arriveMs, v.name, v.arriveMs === null ? v.detail : `${v.headline}. ${v.windowClock ? `Arrival window ${localizeClocks(v.windowClock)}.` : ""}`.trim(), v.severity, v.hoursSource ? "published" : "estimate", v.arriveMs !== null));
    const w = a.weather?.[v.stopId] ?? a.weather?.[a.stops[i]?.id ?? ""];
    if (w && w.basis === "forecast" && w.advice && v.arriveMs !== null) {
      items.push(mk(`weather:${v.stopId}`, "weather", v.arriveMs, `${w.headline} at ${v.name}`, w.advice, w.intensity >= 2 ? "warn" : "info", "forecast"));
    }
  });

  // Terrain: where each segment starts on the clock, interpolated between the stops' arrival times along the road.
  if (a.line && a.line.length >= 2 && a.terrain && a.terrain.length > 0) {
    const anchors: { km: number; atMs: number }[] = [{ km: 0, atMs: a.departureMs }];
    let leaveMs = a.departureMs;
    a.stops.forEach((s, i) => {
      const v = a.verdicts[i];
      const km = kmAlongLine(a.line!, s);
      if (!v || v.arriveMs === null || km === null) return;
      anchors.push({ km, atMs: v.arriveMs });
      leaveMs = v.arriveMs + s.visitMin * MIN;
      anchors.push({ km, atMs: leaveMs }); // standing still at the stop
    });
    const atKm = (km: number): number | null => {
      for (let i = 1; i < anchors.length; i++) {
        const p = anchors[i - 1], q = anchors[i];
        if (km >= p.km && km <= q.km) return q.km === p.km ? p.atMs : p.atMs + ((q.atMs - p.atMs) * (km - p.km)) / (q.km - p.km);
      }
      return null; // beyond the last stop we have no timing: say the distance, not a made-up time
    };
    for (const seg of a.terrain) {
      const t = atKm(seg.startKm);
      items.push(mk(`terrain:${seg.kind}:${seg.startKm}`, "terrain", t === null ? null : Math.round(t), seg.headline, `${seg.detail} Starts about ${Math.round(seg.startKm)} km from the start.`, seg.steepness === "steep" ? "warn" : "info", "terrain-model", true));
    }
  }

  const last = a.verdicts[a.verdicts.length - 1];
  if (last && last.arriveMs !== null) {
    const lastStop = a.stops[a.stops.length - 1];
    items.push(mk("end", "end", last.arriveMs + (lastStop?.visitMin ?? 0) * MIN, "You'd be done", "If everything goes to plan.", "ok", "estimate", true));
  }
  return items.sort((x, y) => (x.atMs ?? Infinity) - (y.atMs ?? Infinity));
}
