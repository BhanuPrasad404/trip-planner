"use client";

// The small "is this the right place?" map under a chosen place: one pin and, for "my current location", how sure the phone is (a
// circle). It does not move or zoom by hand: it only shows. Loaded only once a place is chosen (MapLibre is large; see PlacePreview).
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon } from "@/lib/location/circle";
import { zoomForAccuracy } from "@/lib/location/quality";
import { FALLBACK_STYLE, MAP_PERFORMANCE, MAP_STYLE_URL, STYLE_TIMEOUT_MS } from "@/lib/map/style";

type Props = { lat: number; lng: number; label: string; accuracyM?: number | null };

export default function PlacePreviewMap({ lat, lng, label, accuracyM = null }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    let map: maplibregl.Map;
    try {
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new maplibregl.Map({
        container: box.current, style: MAP_STYLE_URL, center: [lng, lat], zoom: accuracyM ? zoomForAccuracy(accuracyM) : 11.5,
        interactive: false, attributionControl: { compact: true }, ...MAP_PERFORMANCE,
      });
    } catch {
      queueMicrotask(() => setFailed(true)); // WebGL unavailable
      return;
    }
    let styled = false;
    const fallback = setTimeout(() => { if (!styled) map.setStyle(FALLBACK_STYLE); }, STYLE_TIMEOUT_MS);
    map.on("error", () => { if (!styled) { styled = true; clearTimeout(fallback); map.setStyle(FALLBACK_STYLE); } });
    map.on("style.load", () => {
      styled = true; clearTimeout(fallback);
      if (accuracyM && accuracyM > 0 && !map.getSource("acc")) {
        map.addSource("acc", { type: "geojson", data: circlePolygon(lng, lat, accuracyM) as never });
        map.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#1c7c6d", "fill-opacity": 0.15 } });
        map.addLayer({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#1c7c6d", "line-width": 1.5, "line-opacity": 0.6 } });
      }
    });
    new maplibregl.Marker({ color: "#1c7c6d" }).setLngLat([lng, lat]).addTo(map);
    return () => { clearTimeout(fallback); map.remove(); };
  }, [lat, lng, accuracyM]);

  if (failed) {
    return <p className="rounded-xl bg-sky px-3 py-2 text-xs text-ink-muted">A map preview can&apos;t be shown on this device. {label}: {lat.toFixed(4)}, {lng.toFixed(4)}</p>;
  }
  return <div ref={box} role="img" aria-label={`Map showing ${label}`} className="h-36 w-full overflow-hidden rounded-xl border border-line" />;
}
