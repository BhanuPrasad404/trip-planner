// Runtime map theming for any OpenMapTiles-schema vector style (OpenFreeMap Liberty by default).
//   • Themes are DATA (colour tokens). One engine turns tokens into MapLibre paint/layout patches by looking at each
//     layer's source-layer and id — so switching Light ⇄ Dark ⇄ High-contrast is a few hundred setPaintProperty calls on
//     the live map: no style reload, no flicker, camera and our own layers untouched.
//   • Everything is also exposed as small functions: POI clutter control, zoom-based detail, 3D buildings + lighting,
//     custom SVG icons, optional satellite underlay. computeThemePatches() is pure, so it is unit-tested without WebGL.
import type { Map as MapLibreMap } from "maplibre-gl";

export type ThemeId = "light" | "dark" | "contrast";

type RoadColors = { fill: string; casing: string };
export type ThemeTokens = {
  id: ThemeId;
  label: string;
  land: string; water: string; waterLine: string; park: string; wood: string; grass: string; sand: string; landuse: string;
  building: string; buildingEdge: string; extrusion: string;
  road: { motorway: RoadColors; trunk: RoadColors; secondary: RoadColors; minor: RoadColors; service: RoadColors; path: string; rail: string };
  boundary: string;
  text: { primary: string; secondary: string; halo: string; haloWidth: number; water: string; road: string; roadHalo: string; poi: string };
  light: { color: string; intensity: number; position: [number, number, number] };
  /** Whether the shaded-relief raster at world zoom stays visible. */
  relief: boolean;
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  light: {
    id: "light", label: "Light",
    land: "#f8f9fa", water: "#aadaff", waterLine: "#8cc4f2", park: "#c8facc", wood: "#b9e6bd", grass: "#d3f3d4", sand: "#f5ecc8", landuse: "#eef0f2",
    building: "#e8eaed", buildingEdge: "#d4d7db", extrusion: "#e3e5e8",
    road: {
      motorway: { fill: "#ffcf70", casing: "#d99b2b" },
      trunk: { fill: "#ffe3a1", casing: "#e2b95a" },
      secondary: { fill: "#ffffff", casing: "#c9cdd2" },
      minor: { fill: "#ffffff", casing: "#dadce0" },
      service: { fill: "#ffffff", casing: "#e1e3e6" },
      path: "#ffffff", rail: "#b4b8bd",
    },
    boundary: "#9aa0a6",
    text: { primary: "#202124", secondary: "#5f6368", halo: "#ffffff", haloWidth: 1.4, water: "#4a7fb0", road: "#3c4043", roadHalo: "#ffffff", poi: "#5f6368" },
    light: { color: "#ffffff", intensity: 0.35, position: [1.15, 210, 35] },
    relief: true,
  },
  dark: {
    id: "dark", label: "Dark",
    land: "#202124", water: "#17263c", waterLine: "#1f3550", park: "#1b3a29", wood: "#173223", grass: "#1b3a29", sand: "#33302a", landuse: "#26282b",
    building: "#2d2f33", buildingEdge: "#3a3d41", extrusion: "#34373b",
    road: {
      motorway: { fill: "#8a6a1f", casing: "#5a4413" },
      trunk: { fill: "#6b5a2a", casing: "#4a3d1c" },
      secondary: { fill: "#454a4f", casing: "#2a2b2e" },
      minor: { fill: "#3a3e42", casing: "#26282b" },
      service: { fill: "#34373a", casing: "#26282b" },
      path: "#4a4f55", rail: "#4a4d52",
    },
    boundary: "#6b7075",
    text: { primary: "#e8eaed", secondary: "#9aa0a6", halo: "#202124", haloWidth: 1.6, water: "#6f9bcf", road: "#c4c7c5", roadHalo: "#202124", poi: "#9aa0a6" },
    light: { color: "#8ab4f8", intensity: 0.25, position: [1.15, 210, 40] },
    relief: false,
  },
  contrast: {
    id: "contrast", label: "High contrast",
    land: "#0b0b0c", water: "#06223d", waterLine: "#0d3a66", park: "#0e2f1c", wood: "#0b2616", grass: "#0e2f1c", sand: "#2a2616", landuse: "#151516",
    building: "#26262a", buildingEdge: "#55555c", extrusion: "#3a3a40",
    road: {
      motorway: { fill: "#ffd400", casing: "#000000" },
      trunk: { fill: "#ffe566", casing: "#000000" },
      secondary: { fill: "#ffffff", casing: "#000000" },
      minor: { fill: "#e6e6e6", casing: "#000000" },
      service: { fill: "#cfcfcf", casing: "#000000" },
      path: "#9a9a9a", rail: "#8a8a8a",
    },
    boundary: "#bdbdbd",
    text: { primary: "#ffffff", secondary: "#e0e0e0", halo: "#000000", haloWidth: 2.2, water: "#9cd0ff", road: "#ffffff", roadHalo: "#000000", poi: "#e0e0e0" },
    light: { color: "#ffffff", intensity: 0.3, position: [1.15, 210, 35] },
    relief: false,
  },
};
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = "light";
export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && v in THEMES;

// ── Pure patch computation ──────────────────────────────────────────────────────────────────────────────────────────
export type LayerLike = { id: string; type: string; source?: string; "source-layer"?: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> };
export type Patch = { id: string; kind: "paint" | "layout"; prop: string; value: unknown };
export type ThemeOptions = {
  /** A satellite raster sits under the vector layers: land/water/park fills become transparent so imagery shows through. */
  satellite?: boolean;
  /** Replace every label font (the glyph server must have it). Default: keep the style's own fonts. */
  fontStack?: string[];
};

type RoadClass = "motorway" | "trunk" | "secondary" | "minor" | "service" | "path" | "rail";
export function roadClassOf(id: string): RoadClass | null {
  if (/rail|transit/.test(id)) return "rail";
  if (/path|pedestrian/.test(id)) return "path";
  if (/motorway/.test(id)) return "motorway";
  if (/trunk|primary/.test(id)) return "trunk";
  if (/secondary|tertiary|_link|bridge_link|tunnel_link/.test(id)) return "secondary";
  if (/minor|street/.test(id)) return "minor";
  if (/service|track/.test(id)) return "service";
  return null;
}

const hasText = (l: LayerLike) => l.type === "symbol" && !!l.layout && "text-field" in l.layout;

export function computeThemePatches(layers: LayerLike[], t: ThemeTokens, opts: ThemeOptions = {}): Patch[] {
  const out: Patch[] = [];
  const paint = (id: string, prop: string, value: unknown) => out.push({ id, kind: "paint", prop, value });
  const layout = (id: string, prop: string, value: unknown) => out.push({ id, kind: "layout", prop, value });
  const sat = !!opts.satellite;
  const fill = (id: string, color: string, opacity?: number) => {
    paint(id, "fill-color", color);
    if (sat) paint(id, "fill-opacity", 0);
    else if (opacity !== undefined) paint(id, "fill-opacity", opacity);
  };

  for (const l of layers) {
    const sl = l["source-layer"];
    const id = l.id;

    if (l.type === "background") { paint(id, "background-color", t.land); continue; }
    if (l.type === "raster" && id === "natural_earth") { paint(id, "raster-opacity", t.relief ? ["interpolate", ["exponential", 1.5], ["zoom"], 0, 0.6, 6, 0.1] : 0); continue; }

    if (l.type === "fill") {
      if (sl === "water") fill(id, t.water, 1);
      else if (sl === "park") fill(id, t.park, 0.8);
      else if (sl === "landcover") fill(id, /wood/.test(id) ? t.wood : /grass/.test(id) ? t.grass : /sand/.test(id) ? t.sand : t.grass);
      else if (sl === "landuse") fill(id, /park|pitch|track|cemetery/.test(id) ? t.park : t.landuse);
      else if (sl === "building") { paint(id, "fill-color", t.building); paint(id, "fill-outline-color", t.buildingEdge); }
      else if (sl === "aeroway") paint(id, "fill-color", t.landuse);
      continue;
    }

    if (l.type === "fill-extrusion") { paint(id, "fill-extrusion-color", t.extrusion); continue; }

    if (l.type === "line") {
      if (sl === "waterway") paint(id, "line-color", t.waterLine);
      else if (sl === "park") paint(id, "line-color", t.park);
      else if (sl === "boundary") paint(id, "line-color", t.boundary);
      else if (sl === "transportation") {
        const rc = roadClassOf(id);
        if (!rc) continue;
        if (rc === "rail") paint(id, "line-color", t.road.rail);
        else if (rc === "path") paint(id, "line-color", /casing/.test(id) ? t.road.minor.casing : t.road.path);
        else paint(id, "line-color", /casing/.test(id) ? t.road[rc].casing : t.road[rc].fill);
      } else if (sl === "aeroway") paint(id, "line-color", t.road.minor.fill);
      continue;
    }

    if (hasText(l)) {
      const color = sl === "water_name" || sl === "waterway" ? t.text.water
        : sl === "transportation_name" ? t.text.road
        : sl === "poi" ? t.text.poi
        : sl === "place" && /label_(other|village|town)/.test(id) ? t.text.secondary
        : t.text.primary;
      paint(id, "text-color", color);
      paint(id, "text-halo-color", sl === "transportation_name" ? t.text.roadHalo : t.text.halo);
      paint(id, "text-halo-width", t.text.haloWidth);
      if (opts.fontStack?.length) layout(id, "text-font", opts.fontStack);
    }
  }
  return out;
}

type MapLike = Pick<MapLibreMap, "getStyle" | "setPaintProperty" | "setLayoutProperty" | "getLayer" | "setLight">;

/** Re-colour the live map. Safe to call repeatedly (idempotent); never reloads the style. */
export function applyTheme(map: MapLike, id: ThemeId, opts: ThemeOptions = {}): number {
  const t = THEMES[id];
  const layers = (map.getStyle()?.layers ?? []) as unknown as LayerLike[];
  let applied = 0;
  for (const p of computeThemePatches(layers, t, opts)) {
    try {
      if (p.kind === "paint") map.setPaintProperty(p.id, p.prop as never, p.value as never);
      else map.setLayoutProperty(p.id, p.prop as never, p.value as never);
      applied++;
    } catch {
      /* a property that doesn't exist on this layer type in this style — skip it */
    }
  }
  try {
    map.setLight({ anchor: "viewport", color: t.light.color, intensity: t.light.intensity, position: t.light.position });
  } catch { /* style without light support */ }
  return applied;
}

// ── POI clutter ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type PoiMode = "all" | "trip" | "none";
/** "trip": hide generic shops/restaurants/etc. so OUR stops stand out; keep transit + landmarks. "none": hide every POI. */
export const KEEP_POI_CLASSES = ["airport", "bus", "rail", "railway", "hospital", "fuel", "place_of_worship", "stadium", "college", "park", "zoo", "attraction", "monument", "castle"];

export function poiPatches(layers: LayerLike[], mode: PoiMode): { id: string; visible: boolean; keepClasses: string[] | null }[] {
  return layers.filter((l) => l["source-layer"] === "poi" && l.type === "symbol").map((l) => ({
    id: l.id,
    visible: mode !== "none",
    keepClasses: mode === "trip" ? KEEP_POI_CLASSES : null,
  }));
}

const originalFilters = new WeakMap<object, Map<string, unknown>>();
export function setPoiMode(map: Pick<MapLibreMap, "getStyle" | "setLayoutProperty" | "setFilter" | "getLayer">, mode: PoiMode): void {
  const layers = (map.getStyle()?.layers ?? []) as unknown as (LayerLike & { filter?: unknown })[];
  let saved = originalFilters.get(map);
  if (!saved) originalFilters.set(map, (saved = new Map()));
  for (const p of poiPatches(layers, mode)) {
    const layer = layers.find((l) => l.id === p.id)!;
    if (!saved.has(p.id)) saved.set(p.id, layer.filter ?? null);
    map.setLayoutProperty(p.id, "visibility", p.visible ? "visible" : "none");
    const original = saved.get(p.id);
    const keep = p.keepClasses ? ["match", ["get", "class"], p.keepClasses, true, false] : null;
    map.setFilter(p.id, (keep ? (original ? ["all", original, keep] : keep) : original) as never);
  }
}

// ── Level of detail ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Minor streets and dense POIs appear later, and FADE in over one zoom level instead of popping. */
export const LOD_RULES: { match: RegExp; appearAt: number }[] = [
  { match: /^highway-name-(minor|path)$/, appearAt: 15.5 },
  { match: /^poi_r20$/, appearAt: 17.5 },
  { match: /^poi_r7$/, appearAt: 16.5 },
  { match: /^poi_r1$/, appearAt: 15.5 },
  { match: /^label_other$/, appearAt: 9.5 },
  { match: /^road_one_way_arrow/, appearAt: 16.5 },
];

export function lodFor(layers: LayerLike[]): { id: string; minzoom: number; fade: [number, number]; textLayer: boolean }[] {
  return layers.flatMap((l) => {
    const rule = LOD_RULES.find((r) => r.match.test(l.id));
    return rule ? [{ id: l.id, minzoom: rule.appearAt - 1, fade: [rule.appearAt - 1, rule.appearAt] as [number, number], textLayer: hasText(l) }] : [];
  });
}

export function applyLod(map: Pick<MapLibreMap, "getStyle" | "setLayerZoomRange" | "setPaintProperty">): void {
  const layers = (map.getStyle()?.layers ?? []) as unknown as LayerLike[];
  for (const r of lodFor(layers)) {
    try {
      map.setLayerZoomRange(r.id, r.minzoom, 24);
      const ramp = ["interpolate", ["linear"], ["zoom"], r.fade[0], 0, r.fade[1], 1];
      if (r.textLayer) map.setPaintProperty(r.id, "text-opacity", ramp as never);
      map.setPaintProperty(r.id, "icon-opacity", ramp as never);
    } catch { /* layer type without that property */ }
  }
}

// ── 3D buildings ────────────────────────────────────────────────────────────────────────────────────────────────────
export const BUILDINGS_3D = { layerId: "building-3d", minzoom: 15 } as const;

/** Extruded buildings from zoom 15, growing out of the ground between 15 and 16, shaded by the theme's light. */
export function enable3dBuildings(map: Pick<MapLibreMap, "getLayer" | "getSource" | "addLayer" | "setLayerZoomRange" | "setPaintProperty" | "setLight" | "getStyle">, id: ThemeId): boolean {
  const t = THEMES[id];
  if (!map.getLayer(BUILDINGS_3D.layerId)) {
    const source = Object.keys(map.getStyle()?.sources ?? {}).find((s) => (map.getStyle().sources[s] as { type?: string }).type === "vector");
    if (!source) return false;
    map.addLayer({ id: BUILDINGS_3D.layerId, type: "fill-extrusion", source, "source-layer": "building", minzoom: BUILDINGS_3D.minzoom, paint: {} } as never);
  }
  map.setLayerZoomRange(BUILDINGS_3D.layerId, BUILDINGS_3D.minzoom, 24);
  // The flat footprint layer hands over to the 3D one: no gap where buildings vanish between zoom 14 and 15.
  if (map.getLayer("building")) map.setLayerZoomRange("building", 13, BUILDINGS_3D.minzoom);
  map.setPaintProperty(BUILDINGS_3D.layerId, "fill-extrusion-color", t.extrusion);
  map.setPaintProperty(BUILDINGS_3D.layerId, "fill-extrusion-height", ["interpolate", ["linear"], ["zoom"], 15, 0, 16, ["coalesce", ["get", "render_height"], 6]] as never);
  map.setPaintProperty(BUILDINGS_3D.layerId, "fill-extrusion-base", ["interpolate", ["linear"], ["zoom"], 15, 0, 16, ["coalesce", ["get", "render_min_height"], 0]] as never);
  map.setPaintProperty(BUILDINGS_3D.layerId, "fill-extrusion-opacity", 0.86);
  map.setPaintProperty(BUILDINGS_3D.layerId, "fill-extrusion-vertical-gradient", true);
  map.setLight({ anchor: "viewport", color: t.light.color, intensity: t.light.intensity, position: t.light.position });
  return true;
}

// ── Satellite underlay (optional; you supply a tile URL you are licensed to use) ──────────────────────────────────────
export const SATELLITE = { sourceId: "satellite", layerId: "satellite" } as const;
export function setSatellite(map: Pick<MapLibreMap, "getStyle" | "getSource" | "getLayer" | "addSource" | "addLayer" | "removeLayer" | "removeSource">, tilesUrl: string | null): boolean {
  if (!tilesUrl) {
    if (map.getLayer(SATELLITE.layerId)) map.removeLayer(SATELLITE.layerId);
    if (map.getSource(SATELLITE.sourceId)) map.removeSource(SATELLITE.sourceId);
    return false;
  }
  if (!map.getSource(SATELLITE.sourceId)) map.addSource(SATELLITE.sourceId, { type: "raster", tiles: [tilesUrl], tileSize: 256, maxzoom: 19 } as never);
  if (!map.getLayer(SATELLITE.layerId)) {
    const layers = (map.getStyle()?.layers ?? []) as unknown as LayerLike[];
    const before = layers.find((l) => l.type === "line" || l.type === "symbol")?.id; // imagery under roads and labels, above the background
    map.addLayer({ id: SATELLITE.layerId, type: "raster", source: SATELLITE.sourceId } as never, before);
  }
  return true;
}

// ── Custom SVG icons ────────────────────────────────────────────────────────────────────────────────────────────────
/** Turn SVG markup into a map icon (use with a symbol layer's `icon-image`). Browser only. */
export async function registerSvgIcon(map: Pick<MapLibreMap, "hasImage" | "addImage">, id: string, svg: string, size = 32, pixelRatio = 2): Promise<void> {
  if (map.hasImage(id)) return;
  const img = new Image(size * pixelRatio, size * pixelRatio);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size * pixelRatio; canvas.height = size * pixelRatio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
}
