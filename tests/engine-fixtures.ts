// TEST-ONLY helpers for the Phase 3 engine: a straight "road" between two points, a town list, and an EngineInput builder.
import { distanceKm } from "@/lib/geo";
import type { BuilderInput } from "@/lib/trip-builder";
import { DEFAULT_PREFS, type EngineInput, type Prefs, type RoadLine, type Town, type TownFinder } from "@/lib/engine/types";

/** A straight road from a to b, a point every `stepKm`, at `kmh`. */
export function straightLine(a: { lat: number; lng: number }, b: { lat: number; lng: number }, kmh = 55, stepKm = 2, factor = 1.25): RoadLine {
  const total = distanceKm(a, b);
  const steps = Math.max(1, Math.ceil(total / stepKm));
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) coords.push([a.lng + ((b.lng - a.lng) * i) / steps, a.lat + ((b.lat - a.lat) * i) / steps]);
  const pieceKm = (total * factor) / steps;
  return { coords, durations: Array(steps).fill((pieceKm / kmh) * 3600), distances: Array(steps).fill(pieceKm * 1000), source: "osrm" };
}

export function townFinder(towns: Town[]): TownFinder {
  return (lat, lng, maxKm) => towns.map((t) => ({ ...t, km: distanceKm({ lat, lng }, t) })).filter((t) => t.km <= maxKm).sort((x, y) => x.km - y.km || y.pop - x.pop);
}

/** Big towns every ~`everyKm` along a straight line (named T1, T2…), for transit tests. */
export function townsAlong(a: { lat: number; lng: number }, b: { lat: number; lng: number }, everyKm = 30, pop = 50_000): Town[] {
  const total = distanceKm(a, b);
  const n = Math.floor(total / everyKm);
  return Array.from({ length: n }, (_, i) => ({ name: `T${i + 1}`, area: "Somewhere", lat: a.lat + ((b.lat - a.lat) * (i + 1)) / (n + 1), lng: a.lng + ((b.lng - a.lng) * (i + 1)) / (n + 1), pop }));
}

export function engineInput(base: BuilderInput, extra: Partial<Omit<EngineInput, "base" | "prefs">> & { prefs?: Partial<Prefs> } = {}): EngineInput {
  return {
    base, refDateISO: base.startDateISO ?? "2026-12-15", prefs: { ...DEFAULT_PREFS, ...extra.prefs }, heights: extra.heights ?? null,
    towns: extra.towns ?? townFinder([]), outLine: extra.outLine ?? null, backLine: extra.backLine ?? null, weather: extra.weather ?? "none",
    states: extra.states ?? base.places.map(() => null), mileage: extra.mileage === undefined ? 15 : extra.mileage, tolls: extra.tolls ?? null,
  };
}
