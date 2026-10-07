// Provider boundaries. The product talks ONLY to these interfaces, never to a vendor directly,
// so swapping OpenStreetMap/OSRM/Open-Meteo for Mapbox, Google, Here, Tomorrow.io, … means writing one
// adapter and changing one environment variable — not touching planners, routes or screens.
import type { GeoPoint } from "@/lib/geo";
import type { Conditions } from "@/lib/weather";

// ── Routing ────────────────────────────────────────────────────────────────
export type Matrix = {
  durations: number[][]; // seconds, [from][to]
  distances: number[][]; // metres
  source: string; // which provider answered, or "estimate"
  /** Place pairs the routing service could NOT connect by road (islands, missing/closed roads); those cells are straight-line estimates. */
  estimatedPairs?: number;
};

export type RouteLeg = { minutes: number; km: number };
export type RouteResult = {
  legs: RouteLeg[];
  /** [lng, lat] points of the road geometry, ready to draw. */
  line: [number, number][];
  source: string;
};

// ── Turn-by-turn directions ────────────────────────────────────────────────
export type Maneuver = {
  type: string; // "turn", "depart", "arrive", "roundabout", ... (provider-neutral names as used by OSRM/Valhalla)
  modifier?: string; // "left", "slight right", ...
  location: GeoPoint;
  bearingAfter: number | null;
  /** Roundabout exit number. */
  exit?: number;
};
export type NavStep = {
  index: number;
  /** Plain-English instruction built from the maneuver — deterministic, never AI-written. */
  instruction: string;
  name: string;
  ref: string | null;
  maneuver: Maneuver;
  distanceM: number;
  durationS: number;
  /** Where the step starts / ends, in metres along the route line. */
  startAlongM: number;
  endAlongM: number;
};
export type NavRoute = {
  id: string;
  distanceM: number;
  durationS: number;
  line: [number, number][]; // [lng, lat]
  steps: NavStep[];
  /** "via NH65" — the road that carries most of the distance. */
  via: string;
  /** "osrm": real road geometry and maneuvers. "estimate": straight line, no turn-by-turn. */
  source: "osrm" | "estimate";
};

export interface RoutingProvider {
  readonly id: string;
  /** Driving-time/distance matrix between all points (index 0 = origin). Must never throw: degrade to an estimate. */
  matrix(points: GeoPoint[], fetchImpl?: typeof fetch): Promise<Matrix>;
  /** Road route through the points in order. Must never throw: degrade to an estimate. */
  route(points: GeoPoint[], fetchImpl?: typeof fetch): Promise<RouteResult>;
  /** Turn-by-turn route(s) from `from` to `to`, best first. Optional: a provider without it simply gets no navigation. Must never throw. */
  directions?(from: GeoPoint, to: GeoPoint, opts?: { alternatives?: number }, fetchImpl?: typeof fetch): Promise<NavRoute[]>;
}

// ── Places (points of interest) ────────────────────────────────────────────
export type BBox = { south: number; west: number; north: number; east: number };

/** Groups are the unit of bulk ingestion: one provider query per (map tile, group). */
export type PoiGroup = "essentials" | "stay" | "sights" | "parking";

/** What a places provider returns, before our own classification. Tags are the provider's raw key/values. */
export type RawPlace = {
  id: string; // stable id inside the provider, e.g. "node/123"
  lat: number;
  lng: number;
  tags: Record<string, string>;
};

export interface PlacesProvider {
  readonly id: string; // stored with every row, so data from different providers can coexist
  fetchPlaces(bbox: BBox, group: PoiGroup, fetchImpl?: typeof fetch): Promise<RawPlace[]>;
}

// ── Weather ────────────────────────────────────────────────────────────────
export type HourlyWeather = {
  /** ISO time (UTC) of the start of the hour. */
  time: string;
  tempC: number;
  precipMm: number;
  precipProb: number | null; // 0..100
};

export type ConditionsRequest = { id: string; lat: number; lng: number; date: Date };

export interface WeatherProvider {
  readonly id: string;
  /** Forecast (soon) or typical climate (later) for each place on its visit date. Best-effort: missing entries are fine. */
  conditionsFor(requests: ConditionsRequest[], todayISO: string): Promise<Record<string, Conditions>>;
  /** Hour-by-hour forecast for the next `hours` hours at a point. Returns [] when unavailable. */
  hourly(point: GeoPoint, hours: number, fetchImpl?: typeof fetch): Promise<HourlyWeather[]>;
}

// ── Geocoding ──────────────────────────────────────────────────────────────
export type GeocodeHit = {
  lat: number;
  lng: number;
  name: string;
  address: string;
  displayName: string;
  confidence: number;
};

export interface GeocodingProvider {
  readonly id: string;
  search(query: string, bias?: GeoPoint | null): Promise<GeocodeHit[]>;
}

// ── Traffic / road conditions ───────────────────────────────────────────────
export type TrafficIncident = {
  id: string;
  kind: "closure" | "accident" | "congestion" | "roadwork" | "other";
  lat: number;
  lng: number;
  description: string;
  startedAt: string | null;
  source: string;
};

export interface TrafficProvider {
  readonly id: string;
  /** False when no real traffic source is connected. The product then says "not connected" — it never invents conditions. */
  readonly available: boolean;
  incidents(bbox: BBox): Promise<TrafficIncident[]>;
}

// ── Events (festivals, closures, seasonal happenings) ───────────────────────
export type TravelEvent = { id: string; title: string; lat: number; lng: number; startsAt: string; endsAt: string | null; url: string | null; source: string };

export interface EventsProvider {
  readonly id: string;
  readonly available: boolean;
  events(point: GeoPoint, radiusKm: number, from: Date, to: Date): Promise<TravelEvent[]>;
}

// ── Map rendering (configuration only: the browser draws with MapLibre) ─────
export interface MapProvider {
  readonly id: string;
  /** MapLibre style JSON URL, or null to use the built-in OpenStreetMap raster style. */
  readonly styleUrl: string | null;
  readonly attribution: string;
  /** The free OSM tile server forbids heavy use; production needs a real tile provider. */
  readonly production: boolean;
}
