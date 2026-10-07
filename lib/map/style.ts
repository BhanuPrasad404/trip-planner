// Which basemap style to load. Default: OpenFreeMap "Liberty" (vector, 3D buildings, no API key). Its own terms say the
// public service is provided as-is and may change — so ANY style URL can replace it (NEXT_PUBLIC_MAP_STYLE_URL: your own
// OpenFreeMap host, MapTiler, Stadia, …), and if the style cannot load we fall back to plain OSM raster tiles (dev only).
import type { StyleSpecification } from "maplibre-gl";

export const OPENFREEMAP_LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_STYLE_URL: string = process.env.NEXT_PUBLIC_MAP_STYLE_URL || OPENFREEMAP_LIBERTY;
/** Optional raster imagery you are licensed to use, e.g. "https://…/{z}/{x}/{y}.jpg". Empty = no satellite option. */
export const SATELLITE_TILES_URL: string | null = process.env.NEXT_PUBLIC_SATELLITE_TILES_URL || null;

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** How long we wait for the style before switching to the fallback. */
export const STYLE_TIMEOUT_MS = 12_000;

/** Smooth-rendering options for the Map constructor. (MapLibre has no "smoothTileTransform" option; these are the real ones.) */
export const MAP_PERFORMANCE = {
  fadeDuration: 100, // labels and tiles cross-fade in 100 ms instead of 300 ms
  cancelPendingTileRequestsWhileZooming: true, // don't finish downloading tiles for a zoom level we already left
  maxPitch: 70,
  pitchWithRotate: true,
  refreshExpiredTiles: false,
} as const;
