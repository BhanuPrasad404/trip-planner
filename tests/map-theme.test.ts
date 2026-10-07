import { describe, expect, it, vi } from "vitest";
import { THEMES, applyLod, applyTheme, computeThemePatches, enable3dBuildings, lodFor, roadClassOf, setPoiMode, setSatellite, type LayerLike } from "@/lib/map/theme-config";

// A slice of the real OpenFreeMap "Liberty" style (same ids, source-layers and types).
const L = (id: string, type: string, sl?: string, layout?: Record<string, unknown>): LayerLike => ({ id, type, source: "openmaptiles", "source-layer": sl, layout });
const TEXT = { "text-field": ["get", "name"] };
const LIBERTY: LayerLike[] = [
  { id: "background", type: "background" },
  { id: "natural_earth", type: "raster", source: "ne2_shaded" },
  L("park", "fill", "park"), L("park_outline", "line", "park"),
  L("landuse_residential", "fill", "landuse"), L("landuse_cemetery", "fill", "landuse"),
  L("landcover_wood", "fill", "landcover"), L("landcover_grass", "fill", "landcover"), L("landcover_sand", "fill", "landcover"),
  L("waterway_river", "line", "waterway"), L("water", "fill", "water"),
  L("road_motorway_casing", "line", "transportation"), L("road_motorway", "line", "transportation"),
  L("road_trunk_primary_casing", "line", "transportation"), L("road_trunk_primary", "line", "transportation"),
  L("road_secondary_tertiary", "line", "transportation"), L("road_minor_casing", "line", "transportation"), L("road_minor", "line", "transportation"),
  L("road_service_track", "line", "transportation"), L("road_link", "line", "transportation"), L("road_path_pedestrian", "line", "transportation"),
  L("road_major_rail", "line", "transportation"), L("bridge_motorway", "line", "transportation"), L("tunnel_motorway_casing", "line", "transportation"),
  L("road_one_way_arrow", "symbol", "transportation", { "icon-image": "arrow" }),
  L("building", "fill", "building"), L("building-3d", "fill-extrusion", "building"),
  L("boundary_2", "line", "boundary"),
  L("highway-name-major", "symbol", "transportation_name", TEXT), L("highway-name-minor", "symbol", "transportation_name", TEXT),
  L("poi_r1", "symbol", "poi", TEXT), L("poi_r7", "symbol", "poi", TEXT), L("poi_r20", "symbol", "poi", TEXT), L("poi_transit", "symbol", "poi", TEXT),
  L("water_name_point_label", "symbol", "water_name", TEXT), L("label_city", "symbol", "place", TEXT), L("label_village", "symbol", "place", TEXT), L("label_other", "symbol", "place", TEXT),
];
const byId = (patches: ReturnType<typeof computeThemePatches>, id: string, prop: string) => patches.find((p) => p.id === id && p.prop === prop)?.value;

describe("theme colours match the spec", () => {
  it("Light: land #f8f9fa, water #aadaff, parks #c8facc", () => {
    const p = computeThemePatches(LIBERTY, THEMES.light);
    expect(byId(p, "background", "background-color")).toBe("#f8f9fa");
    expect(byId(p, "water", "fill-color")).toBe("#aadaff");
    expect(byId(p, "park", "fill-color")).toBe("#c8facc");
  });
  it("Dark: land #202124, water #17263c, parks #1b3a29, and the world-zoom relief raster is hidden", () => {
    const p = computeThemePatches(LIBERTY, THEMES.dark);
    expect(byId(p, "background", "background-color")).toBe("#202124");
    expect(byId(p, "water", "fill-color")).toBe("#17263c");
    expect(byId(p, "park", "fill-color")).toBe("#1b3a29");
    expect(byId(p, "natural_earth", "raster-opacity")).toBe(0);
  });
  it("highways are soft orange/yellow with a darker border; every road class gets colours; casings differ from fills", () => {
    const p = computeThemePatches(LIBERTY, THEMES.light);
    expect(byId(p, "road_motorway", "line-color")).toBe("#ffcf70");
    expect(byId(p, "road_motorway_casing", "line-color")).toBe("#d99b2b");
    expect(byId(p, "bridge_motorway", "line-color")).toBe("#ffcf70");
    expect(byId(p, "road_trunk_primary", "line-color")).toBe("#ffe3a1");
    expect(byId(p, "road_minor_casing", "line-color")).not.toBe(byId(p, "road_minor", "line-color"));
    expect(byId(p, "road_link", "line-color")).toBe(THEMES.light.road.secondary.fill);
  });
  it("labels get theme colours and halos; icon-only symbols are never given text properties", () => {
    const p = computeThemePatches(LIBERTY, THEMES.dark);
    expect(byId(p, "label_city", "text-color")).toBe("#e8eaed");
    expect(byId(p, "label_city", "text-halo-color")).toBe("#202124");
    expect(byId(p, "water_name_point_label", "text-color")).toBe(THEMES.dark.text.water);
    expect(byId(p, "highway-name-major", "text-color")).toBe(THEMES.dark.text.road);
    expect(p.some((x) => x.id === "road_one_way_arrow")).toBe(false);
  });
  it("satellite mode makes land, water and park fills transparent so imagery shows through", () => {
    const p = computeThemePatches(LIBERTY, THEMES.light, { satellite: true });
    for (const id of ["park", "water", "landcover_wood", "landuse_residential"]) expect(byId(p, id, "fill-opacity")).toBe(0);
    expect(byId(computeThemePatches(LIBERTY, THEMES.light), "water", "fill-opacity")).toBe(1);
  });
  it("a custom font stack is applied to every label layer when asked for", () => {
    const p = computeThemePatches(LIBERTY, THEMES.light, { fontStack: ["Inter Regular"] });
    expect(byId(p, "label_city", "text-font")).toEqual(["Inter Regular"]);
    expect(byId(computeThemePatches(LIBERTY, THEMES.light), "label_city", "text-font")).toBeUndefined();
  });
  it("classifies roads by id", () => {
    expect(roadClassOf("road_motorway_link_casing")).toBe("motorway");
    expect(roadClassOf("tunnel_secondary_tertiary_casing")).toBe("secondary");
    expect(roadClassOf("road_trunk_primary")).toBe("trunk");
    expect(roadClassOf("road_major_rail")).toBe("rail");
    expect(roadClassOf("highway-name-major")).toBeNull(); // a label layer, not a road line
    expect(roadClassOf("airport")).toBeNull();
  });
});

function fakeMap(layers: LayerLike[], filters: Record<string, unknown> = {}) {
  const paint: Record<string, Record<string, unknown>> = {}, layout: Record<string, Record<string, unknown>> = {}, flt: Record<string, unknown> = {}, ranges: Record<string, [number, number]> = {};
  const present = new Set(layers.map((l) => l.id));
  const map = {
    getStyle: () => ({ layers: layers.map((l) => ({ ...l, filter: filters[l.id] })), sources: { openmaptiles: { type: "vector" } } }),
    setPaintProperty: vi.fn((id: string, p: string, v: unknown) => { if (id === "boom") throw new Error("bad"); (paint[id] ??= {})[p] = v; }),
    setLayoutProperty: vi.fn((id: string, p: string, v: unknown) => { (layout[id] ??= {})[p] = v; }),
    setFilter: vi.fn((id: string, f: unknown) => { flt[id] = f; }),
    setLayerZoomRange: vi.fn((id: string, a: number, b: number) => { ranges[id] = [a, b]; }),
    setLight: vi.fn(),
    getLayer: vi.fn((id: string) => (present.has(id) ? { id } : undefined)),
    getSource: vi.fn(() => undefined),
    addLayer: vi.fn((l: { id: string }) => { present.add(l.id); }),
    addSource: vi.fn(), removeLayer: vi.fn(), removeSource: vi.fn(),
  };
  return { map, paint, layout, flt, ranges };
}

describe("applying themes to a live map", () => {
  it("re-colours in place, sets the light, tolerates layers that reject a property, and can switch back and forth", () => {
    const f = fakeMap([...LIBERTY, { id: "boom", type: "fill", "source-layer": "water" }]);
    const n = applyTheme(f.map as never, "dark");
    expect(n).toBeGreaterThan(30);
    expect(f.paint["water"]["fill-color"]).toBe("#17263c");
    expect(f.map.setLight).toHaveBeenCalled();
    applyTheme(f.map as never, "light");
    expect(f.paint["water"]["fill-color"]).toBe("#aadaff");
  });
});

describe("POI clutter control", () => {
  const filters = { poi_r1: ["==", ["get", "x"], 1] };
  it("'trip' keeps landmarks/transit and merges with the style's own filter; 'all' restores it; 'none' hides", () => {
    const f = fakeMap(LIBERTY, filters);
    setPoiMode(f.map as never, "trip");
    expect(f.layout["poi_r1"].visibility).toBe("visible");
    expect(f.flt["poi_r1"]).toEqual(["all", ["==", ["get", "x"], 1], ["match", ["get", "class"], expect.arrayContaining(["rail", "hospital"]), true, false]]);
    setPoiMode(f.map as never, "none");
    expect(f.layout["poi_r7"].visibility).toBe("none");
    setPoiMode(f.map as never, "all");
    expect(f.layout["poi_r1"].visibility).toBe("visible");
    expect(f.flt["poi_r1"]).toEqual(["==", ["get", "x"], 1]);
    expect(f.flt["poi_r7"]).toBeNull();
  });
});

describe("zoom-based detail and 3D buildings", () => {
  it("dense POIs and minor street names appear later and fade in over one zoom level", () => {
    const rules = lodFor(LIBERTY);
    const r20 = rules.find((r) => r.id === "poi_r20")!;
    const r1 = rules.find((r) => r.id === "poi_r1")!;
    expect(r20.minzoom).toBeGreaterThan(r1.minzoom);
    expect(r20.fade[1] - r20.fade[0]).toBe(1);
    const f = fakeMap(LIBERTY);
    applyLod(f.map as never);
    expect(f.ranges["poi_r20"][0]).toBe(16.5);
    expect(f.paint["poi_r20"]["text-opacity"]).toEqual(["interpolate", ["linear"], ["zoom"], 16.5, 0, 17.5, 1]);
  });
  it("extrudes buildings from zoom 15 with theme colour and light; adds the layer if the style lacks it", () => {
    const f = fakeMap(LIBERTY);
    expect(enable3dBuildings(f.map as never, "dark")).toBe(true);
    expect(f.ranges["building-3d"]).toEqual([15, 24]);
    expect(f.ranges["building"]).toEqual([13, 15]); // flat footprints hand over to 3D with no gap
    expect(f.paint["building-3d"]["fill-extrusion-color"]).toBe(THEMES.dark.extrusion);
    expect(f.paint["building-3d"]["fill-extrusion-vertical-gradient"]).toBe(true);
    const bare = fakeMap(LIBERTY.filter((l) => l.id !== "building-3d"));
    expect(enable3dBuildings(bare.map as never, "light")).toBe(true);
    expect(bare.map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "building-3d", type: "fill-extrusion", "source-layer": "building" }));
  });
  it("satellite underlay is added under roads/labels only when a tile URL is supplied", () => {
    const f = fakeMap(LIBERTY);
    expect(setSatellite(f.map as never, null)).toBe(false);
    expect(setSatellite(f.map as never, "https://tiles.example/{z}/{x}/{y}.jpg")).toBe(true);
    expect(f.map.addSource).toHaveBeenCalled();
    expect(f.map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "satellite", type: "raster" }), "park_outline");
  });
});
