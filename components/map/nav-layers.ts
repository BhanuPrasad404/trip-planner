// The route on the map: the iconic blue line (casing + line), the grey "already driven" part, and grey alternative routes.
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { NavRoute } from "@/lib/providers/types";
import { splitRoute, indexRoute, type LngLat } from "@/lib/map/navigation";

export const NAV_COLORS = { casing: "#1557b0", line: "#1a73e8", passed: "#70757a", altLine: "#9aa0a6", altCasing: "#70757a" } as const;
export const NAV_LAYERS = { altCasing: "nav-alt-casing", alt: "nav-alt", altHit: "nav-alt-hit", passed: "nav-passed", remainingCasing: "nav-remaining-casing", remaining: "nav-remaining" } as const;
const SRC = { alt: "nav-alt", passed: "nav-passed", remaining: "nav-remaining" } as const;
const EMPTY = { type: "FeatureCollection", features: [] } as const;

const fillWidth = ["interpolate", ["linear"], ["zoom"], 6, 2, 10, 3.5, 14, 6, 18, 9];
const casingWidth = ["interpolate", ["linear"], ["zoom"], 6, 3.5, 10, 6, 14, 10, 18, 14];

/** The route sits ABOVE roads/buildings but UNDER labels, like a real navigation map. */
function firstLabelLayer(map: MapLibreMap): string | undefined {
  return (map.getStyle()?.layers ?? []).find((l: { type: string; layout?: Record<string, unknown> }) => l.type === "symbol" && "layout" in l && l.layout && "text-field" in l.layout)?.id;
}

/** Idempotent: safe to call again after a style change. */
export function installNavLayers(map: MapLibreMap): void {
  const before = firstLabelLayer(map);
  for (const id of Object.values(SRC)) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY as never });
  const line = (id: string, source: string, color: string, width: unknown, opacity = 1) => {
    if (map.getLayer(id)) return;
    map.addLayer({ id, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": width as never, "line-opacity": opacity } }, before);
  };
  line(NAV_LAYERS.altCasing, SRC.alt, NAV_COLORS.altCasing, casingWidth, 0.9);
  line(NAV_LAYERS.alt, SRC.alt, NAV_COLORS.altLine, fillWidth);
  line(NAV_LAYERS.altHit, SRC.alt, "#000000", 26, 0.001); // fat invisible line so alternatives are easy to tap
  line(NAV_LAYERS.passed, SRC.passed, NAV_COLORS.passed, fillWidth, 0.95);
  line(NAV_LAYERS.remainingCasing, SRC.remaining, NAV_COLORS.casing, casingWidth);
  line(NAV_LAYERS.remaining, SRC.remaining, NAV_COLORS.line, fillWidth);
}

const feature = (coords: LngLat[], props: Record<string, unknown> = {}) => ({ type: "Feature" as const, properties: props, geometry: { type: "LineString" as const, coordinates: coords } });
const set = (map: MapLibreMap, id: string, features: unknown[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features } as never);

const indexCache = new WeakMap<NavRoute, ReturnType<typeof indexRoute>>();
const indexOf = (r: NavRoute) => { let i = indexCache.get(r); if (!i) indexCache.set(r, (i = indexRoute(r))); return i; };

export type NavDrawState = { phase: string; routes: NavRoute[]; selectedId: string | null; alongM: number | null; alternatives?: NavRoute[] };

/** Choosing: selected route in blue, others grey. Navigating: blue ahead, grey behind. Otherwise nothing. */
export function drawNavRoutes(map: MapLibreMap, st: NavDrawState): void {
  const selected = st.routes.find((r) => r.id === st.selectedId) ?? st.routes[0];
  if (!selected || (st.phase !== "choosing" && st.phase !== "navigating" && st.phase !== "arrived")) {
    set(map, SRC.alt, []); set(map, SRC.passed, []); set(map, SRC.remaining, []);
    return;
  }
  if (st.phase === "choosing") {
    set(map, SRC.alt, st.routes.filter((r) => r.id !== selected.id).map((r) => feature(r.line, { id: r.id })));
    set(map, SRC.passed, []);
    set(map, SRC.remaining, [feature(selected.line, { id: selected.id })]);
    return;
  }
  set(map, SRC.alt, (st.alternatives ?? []).map((r) => feature(r.line, { id: r.id }))); // other routes stay tappable, in grey
  const { passed, remaining } = splitRoute(indexOf(selected).index, st.alongM ?? 0);
  set(map, SRC.passed, passed.length >= 2 ? [feature(passed)] : []);
  set(map, SRC.remaining, [feature(remaining)]);
}
