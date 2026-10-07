// Honest placeholders for capabilities that have no real source yet. They return NOTHING (never made-up data)
// and say `available: false`, so screens can show "Live traffic: not connected" instead of fake conditions.
import type { EventsProvider, MapProvider, TrafficProvider } from "./types";

export const noTraffic: TrafficProvider = { id: "none", available: false, incidents: async () => [] };
export const noEvents: EventsProvider = { id: "none", available: false, events: async () => [] };

/** Reads the style from NEXT_PUBLIC_MAP_STYLE_URL (the same value the browser uses). */
export const maplibreStyle: MapProvider = {
  id: "maplibre-style",
  get styleUrl() {
    return process.env.NEXT_PUBLIC_MAP_STYLE_URL || null;
  },
  get attribution() {
    return process.env.NEXT_PUBLIC_MAP_STYLE_URL ? "Map style provider" : "© OpenStreetMap contributors";
  },
  get production() {
    return !!process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  },
};
