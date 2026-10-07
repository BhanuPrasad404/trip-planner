// The ONE place that decides which vendor serves each capability.
// Choose with environment variables (defaults shown); add a vendor with `registerProvider`.
//   ROUTING_PROVIDER=osrm   PLACES_PROVIDER=osm   WEATHER_PROVIDER=open-meteo   GEOCODING_PROVIDER=nominatim
//   TRAFFIC_PROVIDER=none   EVENTS_PROVIDER=none   MAP_PROVIDER=maplibre-style   ("none" = not connected: the app says so instead of inventing data)
// Map TILES are chosen in the browser with NEXT_PUBLIC_MAP_STYLE_URL (any MapLibre style: MapTiler, Stadia, Mapbox, self-hosted).
import { nominatimGeocoding } from "./geocoding-nominatim";
import { overpassPlaces } from "./places-overpass";
import { osrmRouting } from "./routing-osrm";
import { maplibreStyle, noEvents, noTraffic } from "./not-connected";
import type { EventsProvider, GeocodingProvider, MapProvider, PlacesProvider, RoutingProvider, TrafficProvider, WeatherProvider } from "./types";
import { openMeteoWeather } from "./weather-open-meteo";

type Capabilities = {
  routing: RoutingProvider;
  places: PlacesProvider;
  weather: WeatherProvider;
  geocoding: GeocodingProvider;
  traffic: TrafficProvider;
  events: EventsProvider;
  map: MapProvider;
};
export type Capability = keyof Capabilities;

const ENV: Record<Capability, string> = {
  routing: "ROUTING_PROVIDER",
  places: "PLACES_PROVIDER",
  weather: "WEATHER_PROVIDER",
  geocoding: "GEOCODING_PROVIDER",
  traffic: "TRAFFIC_PROVIDER",
  events: "EVENTS_PROVIDER",
  map: "MAP_PROVIDER",
};
const DEFAULT: Record<Capability, string> = { routing: "osrm", places: "osm", weather: "open-meteo", geocoding: "nominatim", traffic: "none", events: "none", map: "maplibre-style" };

const registry: { [K in Capability]: Map<string, Capabilities[K]> } = {
  routing: new Map([[osrmRouting.id, osrmRouting]]),
  places: new Map([[overpassPlaces.id, overpassPlaces]]),
  weather: new Map([[openMeteoWeather.id, openMeteoWeather]]),
  geocoding: new Map([[nominatimGeocoding.id, nominatimGeocoding]]),
  traffic: new Map([[noTraffic.id, noTraffic]]),
  events: new Map([[noEvents.id, noEvents]]),
  map: new Map([[maplibreStyle.id, maplibreStyle]]),
};

/** Plug in another vendor, e.g. registerProvider("routing", mapboxRouting) then set ROUTING_PROVIDER=mapbox. */
export function registerProvider<K extends Capability>(capability: K, provider: Capabilities[K]): void {
  (registry[capability] as Map<string, Capabilities[K]>).set(provider.id, provider);
}

export function getProvider<K extends Capability>(capability: K, env: Record<string, string | undefined> = process.env): Capabilities[K] {
  const wanted = (env[ENV[capability]] || DEFAULT[capability]).trim().toLowerCase();
  const found = (registry[capability] as Map<string, Capabilities[K]>).get(wanted);
  if (!found) {
    const known = [...registry[capability].keys()].join(", ");
    throw new Error(`Unknown ${capability} provider "${wanted}" (set ${ENV[capability]} to one of: ${known}).`);
  }
  return found;
}

export const routingProvider = () => getProvider("routing");
export const placesProvider = () => getProvider("places");
export const weatherProvider = () => getProvider("weather");
export const geocodingProvider = () => getProvider("geocoding");
export const trafficProvider = () => getProvider("traffic");
export const eventsProvider = () => getProvider("events");
export const mapProvider = () => getProvider("map");
