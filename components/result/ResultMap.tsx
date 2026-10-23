"use client";

// The plan on a map: each day's road in its own colour (theme variables --tm-day-N), stops as numbered pins (the same numbers as the day
// cards, so nothing depends on colour), night halts as "bed" pins. A strip that only shows; full screen it can be moved and zoomed.
// Loaded only when shown (MapLibre is large).
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FALLBACK_STYLE, MAP_PERFORMANCE, MAP_STYLE_URL, STYLE_TIMEOUT_MS } from "@/lib/map/style";
import { dayColorVar, type MapDay, type MapPin } from "./map-parts";


const cssVar = (name: string, fallback: string) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};

export default function ResultMap({ days, pins, interactive, className }: { days: MapDay[]; pins: MapPin[]; interactive: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    let map: maplibregl.Map;
    const all = [...days.flatMap((d) => d.coords), ...pins.map((p) => [p.lng, p.lat] as [number, number])];
    if (!all.length) return;
    const bounds = all.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(all[0], all[0]));
    try {
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new maplibregl.Map({ container: box.current, style: MAP_STYLE_URL, bounds, fitBoundsOptions: { padding: 36, maxZoom: 13 }, interactive, attributionControl: { compact: true }, ...MAP_PERFORMANCE });
    } catch {
      queueMicrotask(() => setFailed(true)); // WebGL unavailable
      return;
    }
    let styled = false;
    const fallback = setTimeout(() => { if (!styled) map.setStyle(FALLBACK_STYLE); }, STYLE_TIMEOUT_MS);
    const draw = () => {
      for (const d of days) {
        const id = `day-${d.day}`;
        if (map.getSource(id) || d.coords.length < 2) continue;
        map.addSource(id, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: d.coords } } });
        map.addLayer({ id: `${id}-case`, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": cssVar("--tm-map-stop-text", "#ffffff"), "line-width": 7, "line-opacity": 0.8 } });
        map.addLayer({ id, type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": cssVar(dayColorVar(d.day), "#1c7c6d"), "line-width": 4 } });
      }
    };
    map.on("error", () => { if (!styled) { styled = true; clearTimeout(fallback); map.setStyle(FALLBACK_STYLE); } });
    map.on("style.load", () => { styled = true; clearTimeout(fallback); draw(); });
    for (const p of pins) {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.textContent = p.kind === "halt" ? "⌂" : p.label;
      el.style.cssText = `min-width:26px;height:26px;padding:0 6px;border-radius:13px;display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid ${cssVar("--tm-map-stop-text", "#fff")};background:${p.kind === "halt" ? cssVar("--tm-map-halt", "#e8a33d") : cssVar("--tm-map-stop", "#0b3d3a")};color:${p.kind === "halt" ? cssVar("--tm-map-halt-text", "#1c2430") : cssVar("--tm-map-stop-text", "#fff")}`;
      new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    }
    return () => { clearTimeout(fallback); map.remove(); };
  }, [days, pins, interactive]);

  if (failed) return <p className="rounded-xl bg-sky px-3 py-2 text-sm text-ink-muted">A map can&apos;t be shown on this device. The days below list every stop in order.</p>;
  return <div ref={box} role="img" aria-label={`Map of the plan: ${days.length} ${days.length === 1 ? "day" : "days"}, stops numbered as in the day list`} className={className ?? "h-44 w-full overflow-hidden rounded-2xl border border-line"} />;
}
