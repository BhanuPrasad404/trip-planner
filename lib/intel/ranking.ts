// "Is this place actually useful to ME, right now, on THIS road?" — not "is it within a radius".
// Every score component is explained in plain words (RankedPoi.reasons) so nothing feels like a black box.
import type { GeoPoint } from "@/lib/geo";
import { KIND_META, type PoiKind, type PoiRecord } from "@/lib/poi/types";
import { openStatus } from "./hours";
import { DETOUR, OPENNESS, SCORE_WEIGHTS, WEATHER_FIT } from "./weights";
import { project, type RouteIndex } from "./route-geometry";
import type { Prefs, RankedPoi, TripType, WeatherSample } from "./types";

/** How far ahead (km) a place of each kind stops being interesting. Fuel matters far down the road; parking only right here. */
export const SCALE_KM: Record<PoiKind, number> = {
  fuel: 35, ev: 35, food: 20, cafe: 20, restroom: 15, pharmacy: 30, hospital: 40, atm: 30, repair: 40, stay: 30, viewpoint: 30, sight: 40, parking: 5,
};

/** Trip-type personalisation: what this kind of traveller tends to care about. 1 = neutral. */
export const PREF_WEIGHT: Record<TripType, Partial<Record<PoiKind, number>>> = {
  friends: { sight: 1.1, viewpoint: 1.1, food: 1.05 },
  family: { restroom: 1.3, food: 1.15, hospital: 1.2, pharmacy: 1.15, stay: 1.1, viewpoint: 0.95, parking: 1.1 },
  couple: { viewpoint: 1.25, cafe: 1.2, food: 1.1, stay: 1.1 },
  solo: { stay: 1.1, atm: 1.1, cafe: 1.1, hospital: 1.05 },
  biker: { fuel: 1.2, cafe: 1.2, viewpoint: 1.2, repair: 1.3, stay: 0.9, parking: 0.9 },
  backpacker: { atm: 1.1, food: 1.05, stay: 0.95, sight: 1.05 },
};

const KNOWN_BRAND =
  /(\bhp\b|hindustan petroleum|indian ?oil|iocl|bharat petroleum|bpcl|shell|reliance|nayara|jio-?bp|mcdonald|kfc|domino|subway|starbucks|cafe coffee day|barista|haldiram|pizza hut|burger king|apollo|medplus|\bsbi\b|state bank|hdfc|icici|axis bank|taj|oyo|marriott|ibis)/i;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const localMinute = (utcMs: number, offsetMin: number) => {
  const d = new Date(utcMs + offsetMin * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
export const clockLabel = (utcMs: number, offsetMin: number) => {
  const m = localMinute(utcMs, offsetMin);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const poiKey = (p: { source: string; source_id: string }) => `${p.source}|${p.source_id}`;

export type WeatherAt = { tempC: number; precipMm: number; precipProb: number | null };

/** Forecast for the sample nearest to `point`, at the hour containing `tMs`. */
export function weatherAt(samples: WeatherSample[], point: GeoPoint, tMs: number): WeatherAt | null {
  let best: WeatherSample | null = null;
  let bestD = Infinity;
  for (const s of samples) {
    const d = (s.lat - point.lat) ** 2 + (s.lng - point.lng) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return null;
  for (const h of best.hours) {
    const start = Date.parse(h.time);
    if (tMs >= start && tMs < start + 3_600_000) return { tempC: h.tempC, precipMm: h.precipMm, precipProb: h.precipProb };
  }
  return null;
}

export const isRainy = (w: WeatherAt | null) => !!w && ((w.precipProb ?? 0) >= WEATHER_FIT.rainyProbPct || w.precipMm >= WEATHER_FIT.rainyMm);

export type RankContext = {
  route: RouteIndex;
  userAlongM: number;
  nowMs: number;
  utcOffsetMin: number;
  avgKmh: number;
  /** Planned stops along the route (their stay time delays everything beyond them). */
  stopsAlong: { alongM: number; visitMin: number }[];
  weather: WeatherSample[];
  prefs: Prefs;
  boost: Record<string, number>;
  /** Real detours measured with the routing service, by place key (see detour.ts). Anything not listed is estimated. */
  roadDetours?: Record<string, { km: number; min: number }>;
};

export const etaMinutesTo = (alongM: number, ctx: Pick<RankContext, "userAlongM" | "avgKmh" | "stopsAlong">) => {
  const driving = (Math.max(0, alongM - ctx.userAlongM) / 1000 / ctx.avgKmh) * 60;
  const stays = ctx.stopsAlong.filter((s) => s.alongM < alongM - 200 && s.alongM > ctx.userAlongM).reduce((sum, s) => sum + s.visitMin, 0);
  return driving + stays;
};

export function rankPois(pois: PoiRecord[], ctx: RankContext, opts: { includeClosed?: boolean; maxOffsetM?: number } = {}): RankedPoi[] {
  const maxOffset = opts.maxOffsetM ?? 3000;
  const out: RankedPoi[] = [];

  for (const p of pois) {
    const { alongM, offsetM, behindStart } = project(ctx.route, { lat: p.lat, lng: p.lng });
    if (offsetM > maxOffset) continue;
    if (behindStart && offsetM > 200) continue; // before where you are now — not "ahead", just snapped to the start of the road
    const aheadM = alongM - ctx.userAlongM;
    if (aheadM < -200) continue; // behind us

    const aheadKm = Math.max(0, aheadM) / 1000;
    const etaMin = etaMinutesTo(alongM, ctx);
    const arriveAtMs = ctx.nowMs + etaMin * 60_000;
    // Leaving the road and coming back: out + back at ~35 km/h, plus a minute to turn in/park.
    const onRoad = offsetM <= DETOUR.onRoadWithinM;
    const road = onRoad ? undefined : ctx.roadDetours?.[poiKey(p)];
    const detourMin = onRoad ? 0 : road ? Math.round(road.min) : Math.round((offsetM * 2) / DETOUR.metresPerMinute + DETOUR.fixedMin);
    const detourBasis: "road" | "estimate" | "none" = onRoad ? "none" : road ? "road" : "estimate";
    if (road && detourMin > DETOUR.maxPracticalMin) continue; // measured by road: too far out of your way to be a sensible stop
    const open = openStatus(p.tags.opening_hours, arriveAtMs, ctx.utcOffsetMin);
    if (open.state === "closed" && !opts.includeClosed) continue;

    const key = poiKey(p);
    const boost = ctx.boost[key] ?? 0;
    const brand = p.tags.brand || p.tags.operator || null;

    const proximity = Math.exp(-aheadKm / SCALE_KM[p.kind]);
    const detour = 1 / (1 + detourMin / DETOUR.halfScoreAtMin);
    const openness = OPENNESS[open.state === "open" ? "open" : open.state === "unknown" ? "unknown" : "closed"];
    const quality = clamp(0.3 + (p.name ? 0.2 : 0) + (brand && KNOWN_BRAND.test(brand) ? 0.15 : 0) + (p.tags.opening_hours ? 0.1 : 0) + (p.tags.website ? 0.1 : 0) + boost * 0.15, 0, 1);
    const fresh = clamp(boost, 0, 1);
    const W = SCORE_WEIGHTS;
    const base = proximity * W.proximity + detour * W.detour + openness * W.openness + quality * W.quality + fresh * W.freshness;

    let mult = ctx.prefs.tripType ? PREF_WEIGHT[ctx.prefs.tripType][p.kind] ?? 1 : 1;
    const w = weatherAt(ctx.weather, p, arriveAtMs);
    const reasons: string[] = [];
    if (isRainy(w)) {
      if (p.kind === "viewpoint") { mult *= WEATHER_FIT.rainyViewpoint; reasons.push("Rain is forecast there then"); }
      else if (p.kind === "sight") { mult *= WEATHER_FIT.rainySight; reasons.push("Rain is forecast there then"); }
      else if (p.kind === "food" || p.kind === "cafe") { mult *= WEATHER_FIT.rainShelter; reasons.push("Good shelter from the rain"); }
    } else if (w && w.tempC >= WEATHER_FIT.hotFromC && (p.kind === "cafe" || p.kind === "food")) {
      mult *= WEATHER_FIT.hotCoolBreak;
      reasons.push(`${Math.round(w.tempC)}°C there — a cool break`);
    }

    reasons.unshift(
      onRoad
        ? `${aheadKm < 1 ? "Just ahead" : `${Math.round(aheadKm)} km ahead`}, right on your road`
        : road
          ? `${Math.round(aheadKm)} km ahead, ${Math.round(road.km * 10) / 10} km / ${detourMin} min detour by road`
          : `${Math.round(aheadKm)} km ahead, about ${detourMin} min detour (estimated)`
    );
    if (open.state === "open" && open.at) reasons.push(`Open until ${open.at}`);
    else if (open.state === "unknown") reasons.push("Opening hours not listed");
    if (brand && KNOWN_BRAND.test(brand)) reasons.push(brand);
    if (boost > 0) reasons.push("Fresh updates from travelers");

    out.push({
      key,
      kind: p.kind,
      name: p.name ?? KIND_META[p.kind].label,
      lat: p.lat,
      lng: p.lng,
      brand,
      hours: p.tags.opening_hours ?? null,
      alongM,
      offsetM: Math.round(offsetM),
      aheadKm: Math.round(aheadKm * 10) / 10,
      detourMin,
      detourKm: road ? Math.round(road.km * 10) / 10 : null,
      detourBasis,
      etaMin: Math.round(etaMin),
      arriveClock: clockLabel(arriveAtMs, ctx.utcOffsetMin),
      open,
      score: Math.round(clamp(base * 100 * mult, 0, 100)),
      reasons,
      tags: p.tags,
      fetchedAt: p.fetched_at,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
