"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { markerIcon } from "@/lib/client/marker-icon";
import { circlePolygon } from "@/lib/location/circle";
import { zoomForAccuracy } from "@/lib/location/quality";
import { FALLBACK_STYLE, MAP_PERFORMANCE, MAP_STYLE_URL, SATELLITE_TILES_URL, STYLE_TIMEOUT_MS } from "@/lib/map/style";
import { DEFAULT_THEME, applyLod, applyTheme, enable3dBuildings, setPoiMode, setSatellite, type PoiMode, type ThemeId } from "@/lib/map/theme-config";
import { NAV_PITCH, navZoom, type NavProgress } from "@/lib/map/navigation";
import type { RouteChoice } from "@/lib/map/directions";
import type { NavRoute } from "@/lib/providers/types";
import type { NavPhase, Puck } from "@/lib/client/use-navigation";
import { NAV_LAYERS, drawNavRoutes, installNavLayers } from "./map/nav-layers";
import { NavCamera } from "./map/nav-camera";
import { createPuck } from "./map/puck";
import { indexRoute } from "@/lib/map/navigation";
import { pointAt } from "@/lib/intel/route-geometry";
import { contentKey as makeContentKey, fitKey as makeFitKey } from "@/lib/map/fit-key";

export type MapPlace = { id: string; name: string; lat: number; lng: number; day: number | null; order: number | null };
type Anchor = { lat: number; lng: number; label: string };
export type LiveMarker = { id: string; label: string; color: string; lat: number; lng: number; me: boolean; stale: boolean; /** How precise this position is (m). Drawn as a ring; null = unknown. */ accuracyM?: number | null };
export type PoiMarker = { id: string; kind: string; name: string; lat: number; lng: number; highlight: boolean };
type Props = {
  places: MapPlace[];
  start: Anchor | null;
  destination: Anchor | null;
  activeDay: number;
  /** "day": frame the active day's stops; "all": frame the whole trip. The start/destination are ALWAYS in frame. */
  fit: "day" | "all";
  /** Live positions (you + friends who are sharing). Updated in place, never refits the map. */
  live?: LiveMarker[];
  /** The road from you to the next stops, as [lng, lat] points. */
  driveLine?: [number, number][] | null;
  /** Useful places ahead (fuel, food, …) from Trip Intelligence. Highlighted ones are what we are recommending right now. */
  pois?: PoiMarker[];
  /** Include the trip's start and destination when framing the map (turn off in Live mode to frame the day's road instead). */
  frameStartDest?: boolean;
  /** Keep the map centred on you. */
  follow?: boolean;
  /** Called when the person drags the map by hand (so the caller can stop following). */
  onUserPan?: () => void;
  /** Colour theme for the basemap. Switching never reloads the map. */
  theme?: ThemeId;
  /** "trip" hides generic shops/restaurants so OUR stops stand out; "all" shows everything; "none" hides POIs. */
  poiMode?: PoiMode;
  /** Show the satellite underlay (only if NEXT_PUBLIC_SATELLITE_TILES_URL is set). */
  satellite?: boolean;
  /** Turn-by-turn navigation state; when present the map draws the route, the puck and the 3D driver camera. */
  nav?: NavMapProps | null;
  /** Tap an alternative route (line or time badge) to choose it. */
  onSelectRoute?: (id: string) => void;
  /** Heading-up (turn with the road while moving) or north-up. */
  headingUp?: boolean;
  /** "Overview": frame you + the destination + the route. */
  viewRequest?: { kind: "overview"; n: number } | null;
  /** "Re-centre": a COMMAND (not a state): glide to the current position and resume following. Works every time, even when you have not moved. */
  recenter?: { n: number } | null;
  /** The compass was tapped while following (switch between heading-up and north-up). */
  onCompass?: () => void;
};

export type NavMapProps = {
  phase: NavPhase;
  routes: NavRoute[];
  selectedId: string | null;
  choices: RouteChoice[];
  progress: NavProgress | null;
  puck: Puck | null;
  speedKmh: number | null;
  alternatives: NavRoute[];
  altChoices: RouteChoice[];
  /** Where the current navigation is heading (always marked on the map). */
  target: { lat: number; lng: number; name: string } | null;
};

export const DAY_COLORS = ["#1C7C6D", "#C1542C", "#E8A33D", "#3B6EA5", "#7A5C9E", "#4F8A3C", "#B04A7D", "#6B7280"];
const colorFor = (day: number | null) => (day ? DAY_COLORS[(day - 1) % DAY_COLORS.length] : "#6B7280");

const EMPTY_FEATURES = { type: "FeatureCollection", features: [] } as const;
const EMPTY_LINE = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } as const;

function pin(label: string, color: string, dim: boolean, square = false) {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText = [
    "width:28px", "height:28px", `border-radius:${square ? "8px" : "50%"}`, `background:${color}`, "color:#fff",
    "display:flex", "align-items:center", "justify-content:center", "font:600 12px ui-monospace,monospace",
    "border:2px solid #fff", "box-shadow:0 1px 4px rgba(0,0,0,.4)", `opacity:${dim ? 0.5 : 1}`, "cursor:pointer",
  ].join(";");
  return el;
}

/** Start (green) and destination (red, checkered flag) pins: teardrop SVGs with a soft drop shadow. Static markup only. */
function routePin(kind: "start" | "dest"): HTMLDivElement {
  const el = document.createElement("div");
  const color = kind === "start" ? "#1e8e3e" : "#d93025";
  const glyph = kind === "start"
    ? '<circle cx="15" cy="14.5" r="5" fill="#fff"/>'
    : '<g transform="translate(8.5 8)"><rect width="13" height="13" rx="1.5" fill="#fff"/><rect x="0" y="0" width="3.25" height="3.25" fill="#202124"/><rect x="6.5" y="0" width="3.25" height="3.25" fill="#202124"/><rect x="3.25" y="3.25" width="3.25" height="3.25" fill="#202124"/><rect x="9.75" y="3.25" width="3.25" height="3.25" fill="#202124"/><rect x="0" y="6.5" width="3.25" height="3.25" fill="#202124"/><rect x="6.5" y="6.5" width="3.25" height="3.25" fill="#202124"/><rect x="3.25" y="9.75" width="3.25" height="3.25" fill="#202124"/><rect x="9.75" y="9.75" width="3.25" height="3.25" fill="#202124"/></g>';
  el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))"><path d="M15 39C15 39 2 24.5 2 14.5a13 13 0 0 1 26 0C28 24.5 15 39 15 39z" fill="${color}" stroke="#fff" stroke-width="2"/>${glyph}</svg>`;
  el.style.cursor = "pointer";
  return el;
}

function liveDot(label: string, color: string, me: boolean, stale: boolean) {
  const el = document.createElement("div");
  el.textContent = me ? "" : label;
  el.style.cssText = [
    `width:${me ? 22 : 30}px`, `height:${me ? 22 : 30}px`, "border-radius:50%", `background:${me ? "#2563EB" : color}`, "color:#fff",
    "display:flex", "align-items:center", "justify-content:center", "font:700 13px system-ui,sans-serif",
    "border:3px solid #fff", `box-shadow:0 0 0 ${me ? 8 : 0}px rgba(37,99,235,.25),0 1px 5px rgba(0,0,0,.45)`, `opacity:${stale ? 0.5 : 1}`,
  ].join(";");
  return el;
}

/** Hide the quiet (not recommended) place badges until you zoom in; recommended ones are always visible. */
function applyDeclutter(map: maplibregl.Map, markers: Map<string, maplibregl.Marker>) {
  const zoomedIn = map.getZoom() >= 10;
  for (const m of markers.values()) {
    const el = m.getElement();
    el.style.display = el.dataset.hl === "1" || zoomedIn ? "flex" : "none";
  }
}

export default function TripMap({ places, start, destination, activeDay, fit, live = [], driveLine = null, pois = [], frameStartDest = true, follow = false, onUserPan, theme = DEFAULT_THEME, poiMode = "trip", satellite = false, nav = null, onSelectRoute, headingUp = true, viewRequest = null, recenter = null, onCompass }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const liveMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const poiMarkers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const lastFollow = useRef<string>("");
  const badgeMarkers = useRef<maplibregl.Marker[]>([]);
  const camRef = useRef<NavCamera | null>(null);
  const targetMarker = useRef<maplibregl.Marker | null>(null);
  const simpleFollowZoomed = useRef(false);
  const zoomTarget = useRef(17);
  const compassRef = useRef<HTMLButtonElement>(null);
  const puckHandle = useRef<{ setHeadingKnown: (k: boolean) => void } | null>(null);
  const latest = useRef<{ puck: Puck | null; me: { lat: number; lng: number; accuracyM?: number | null } | null; headingUp: boolean; speed: number | null; navigating: boolean }>({ puck: null, me: null, headingUp: true, speed: null, navigating: false });
  const compassCb = useRef(onCompass);
  const followRef = useRef(follow);
  const selectRef = useRef(onSelectRoute);
  const [styleGen, setStyleGen] = useState(0); // bumps every time a style (re)loads, so data layers are redrawn
  const navigating = nav?.phase === "navigating";
  const fitBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  // Compared by VALUE: new object identities on every render must not redraw markers or re-frame the map.
  const keyArgs = { places: places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, day: p.day, order: p.order ?? null })), start, destination, activeDay };
  const contentKey = makeContentKey(keyArgs);
  const fitKey = makeFitKey({ ...keyArgs, fit, frameStartDest });
  useEffect(() => {
    followRef.current = follow;
    selectRef.current = onSelectRoute;
  });
  // Follow mode changes (the traveller panned away, or tapped Re-centre): the camera glides back, never jumps.
  useEffect(() => {
    camRef.current?.setFollowing(follow);
    simpleFollowZoomed.current = false;
    lastFollow.current = ""; // following again must act even if you have not moved (it used to do nothing then)
  }, [follow]);
  useEffect(() => {
    latest.current = { puck: nav?.puck ?? null, me: live.find((l) => l.me) ?? null, headingUp, speed: nav?.speedKmh ?? null, navigating };
    compassCb.current = onCompass;
  });
  const panRef = useRef(onUserPan);
  useEffect(() => {
    panRef.current = onUserPan;
  });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      // Turbopack breaks MapLibre's automatic worker lookup, so point it at the copy in /public
      // (placed there by scripts/copy-maplibre-worker.mjs before dev/build).
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      map = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [78.5, 18.5],
        zoom: 5,
        attributionControl: { compact: true },
        ...MAP_PERFORMANCE,
      });
    } catch {
      // WebGL unavailable (some old devices / blocked GPUs).
      queueMicrotask(() => setFailed(true));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // ANY hand movement of the map (drag, pinch, wheel, +/- buttons, rotate, tilt) switches off auto-follow, so the camera
    // never fights the traveller. Our own camera moves carry no originalEvent and are ignored here.
    for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"] as const) {
      map.on(ev, (e) => { if ((e as { originalEvent?: unknown }).originalEvent) panRef.current?.(); });
    }
    // Our own layers (accuracy ring, drive line, plan line, navigation route) are added every time a style finishes
    // loading — also after the fallback style replaces one that could not load.
    map.on("style.load", () => {
      if (!map.getSource("accuracy")) {
        map.addSource("accuracy", { type: "geojson", data: EMPTY_FEATURES as never });
        map.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": "#2563EB", "fill-opacity": 0.12 } });
        map.addLayer({ id: "accuracy-line", type: "line", source: "accuracy", paint: { "line-color": "#2563EB", "line-width": 1.5, "line-opacity": 0.5 } });
      }
      if (!map.getSource("drive")) {
        map.addSource("drive", { type: "geojson", data: EMPTY_LINE as never });
        map.addLayer({ id: "drive", type: "line", source: "drive", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563EB", "line-width": 5, "line-opacity": 0.85 } });
      }
      if (!map.getSource("route")) {
        map.addSource("route", { type: "geojson", data: EMPTY_LINE as never });
        map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0B3D3A", "line-width": 3, "line-dasharray": [2, 2] } });
      }
      installNavLayers(map);
      setReady(true);
      setStyleGen((n) => n + 1);
    });
    // Tapping a grey alternative route chooses it.
    map.on("click", NAV_LAYERS.altHit, (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") selectRef.current?.(id);
    });
    map.on("mouseenter", NAV_LAYERS.altHit, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", NAV_LAYERS.altHit, () => { map.getCanvas().style.cursor = ""; });
    // The public style server is "as-is": if it cannot be reached, show plain OSM tiles instead of a blank map.
    let usedFallback = false;
    const toFallback = () => { if (usedFallback) return; usedFallback = true; map.setStyle(FALLBACK_STYLE); };
    const styleTimer = window.setTimeout(() => { if (!map.isStyleLoaded()) toFallback(); }, STYLE_TIMEOUT_MS);
    map.on("error", (e) => { if (!map.isStyleLoaded() && /style|sprite|glyph|planet|openfreemap/i.test(String((e.error as { message?: string } | undefined)?.message ?? ""))) toFallback(); });
    map.once("load", () => window.clearTimeout(styleTimer));
    mapRef.current = map;
    const currentMarkers = markers;
    const currentLive = liveMarkers;
    const currentPois = poiMarkers;
    return () => {
      currentMarkers.current.forEach((m) => m.remove());
      currentMarkers.current = [];
      currentLive.current.forEach((m) => m.remove());
      currentLive.current.clear();
      currentPois.current.forEach((m) => m.remove());
      currentPois.current.clear();
      window.clearTimeout(styleTimer);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Redraw markers + the active day's route whenever data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const bounds = new maplibregl.LngLatBounds();

    const add = (el: HTMLElement, lng: number, lat: number, label: string, anchor: "center" | "bottom" = "center") => {
      el.setAttribute("title", label);
      markers.current.push(
        new maplibregl.Marker({ element: el, anchor })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(label))
          .addTo(map)
      );
    };

    const coord = (a: Anchor) => `${a.lat.toFixed(3)}, ${a.lng.toFixed(3)}`;
    if (start) {
      add(routePin("start"), start.lng, start.lat, `Start: ${start.label} (${coord(start)})`, "bottom");
      if (frameStartDest) bounds.extend([start.lng, start.lat]);
    }
    if (destination) {
      add(routePin("dest"), destination.lng, destination.lat, `Destination: ${destination.label} (${coord(destination)})`, "bottom");
      if (frameStartDest) bounds.extend([destination.lng, destination.lat]);
    }

    const dayStops = places.filter((p) => p.day === activeDay).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const p of places) {
      const active = p.day === activeDay;
      add(pin(active ? String(p.order ?? "") : p.day ? String(p.day) : "•", colorFor(p.day), !active), p.lng, p.lat, `${p.name} (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})`);
      if (fit === "all" || active) bounds.extend([p.lng, p.lat]);
    }

    const line: [number, number][] = dayStops.map((p) => [p.lng, p.lat]);
    if (activeDay === 1 && start) line.unshift([start.lng, start.lat]);
    // The dashed plan line is straight segments between stops; while real directions are shown it would only confuse.
    const planHidden = ["loading", "choosing", "navigating", "arrived"].includes(nav?.phase ?? "");
    (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: planHidden ? [] : line },
    });

    fitBoundsRef.current = bounds; // framing happens in its own effect, only when the framing KEY changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the CONTENT (by value) changes, not on every new object identity
  }, [contentKey, ready, nav?.phase, styleGen]);

  // Frame the stops — once per real change (a different day, new stops), never because of a re-render. While you navigate or
  // follow yourself, the camera belongs to you / the navigation, not to this.
  useEffect(() => {
    const map = mapRef.current;
    const b = fitBoundsRef.current;
    if (!map || !ready || !b || b.isEmpty() || navigating) return;
    map.fitBounds(b, { padding: 56, maxZoom: 12, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitKey is the value that says "the thing to frame changed"
  }, [fitKey, ready]);

  // Useful places ahead: small round icon badges (fuel, hospital, cafe, ...), added/removed as the suggestions change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    for (const p of pois) {
      const id = `${p.id}|${p.highlight ? "h" : "n"}`; // re-created when a place becomes (or stops being) recommended
      seen.add(id);
      if (poiMarkers.current.has(id)) continue;
      const el = markerIcon(p.kind, p.highlight ? 32 : 26, p.highlight);
      el.dataset.hl = p.highlight ? "1" : "0";
      el.setAttribute("title", p.name);
      poiMarkers.current.set(
        id,
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(p.name)).addTo(map)
      );
    }
    for (const [id, m] of poiMarkers.current) {
      if (!seen.has(id)) {
        m.remove();
        poiMarkers.current.delete(id);
      }
    }
    applyDeclutter(map, poiMarkers.current);
    const onZoom = () => applyDeclutter(map, poiMarkers.current);
    map.on("zoom", onZoom);
    return () => void map.off("zoom", onZoom);
  }, [pois, ready]);

  // Road route from you to the next stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("drive") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: driveLine ?? [] },
    });
  }, [driveLine, ready, styleGen]);

  // Live dots: move existing markers in place (no flicker, no refit), add new ones, drop the ones that left.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    for (const l of live) {
      if (l.me && navigating) continue; // the navigation puck replaces the plain dot
      seen.add(l.id);
      const existing = liveMarkers.current.get(l.id);
      if (existing) {
        existing.setLngLat([l.lng, l.lat]);
      } else {
        const el = liveDot(l.label, l.color, l.me, l.stale);
        el.setAttribute("title", l.me ? "You are here" : `${l.label} (live)`);
        liveMarkers.current.set(l.id, new maplibregl.Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(map));
      }
    }
    for (const [id, marker] of liveMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        liveMarkers.current.delete(id);
      }
    }
    const me = live.find((l) => l.me);
    const ring = map.getSource("accuracy") as maplibregl.GeoJSONSource | undefined;
    ring?.setData(me && me.accuracyM && me.accuracyM > 25 ? { type: "FeatureCollection", features: [circlePolygon(me.lng, me.lat, me.accuracyM)] } : (EMPTY_FEATURES as never));
    if (follow && me && !navigating) {
      const key = `${me.lat.toFixed(5)},${me.lng.toFixed(5)}`;
      if (key !== lastFollow.current) {
        lastFollow.current = key;
        if (!simpleFollowZoomed.current) {
          // First fix of this follow session: zoom to what the position can justify (street level only for a precise fix).
          simpleFollowZoomed.current = true;
          const z = zoomForAccuracy(me.accuracyM ?? null);
          map.easeTo({ center: [me.lng, me.lat], zoom: (me.accuracyM ?? Infinity) > 150 ? z : Math.max(map.getZoom(), z), duration: 700 });
        } else {
          map.easeTo({ center: [me.lng, me.lat], duration: 700 }); // keep you in view; the zoom stays whatever it is
        }
      }
    }
  }, [live, follow, ready, navigating, styleGen]);

  // ── Basemap look: theme, level of detail, 3D buildings, POI clutter, optional satellite ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      const sat = !!SATELLITE_TILES_URL && satellite;
      setSatellite(map, sat ? SATELLITE_TILES_URL : null);
      applyTheme(map, theme, { satellite: sat });
      applyLod(map);
      enable3dBuildings(map, theme);
      setPoiMode(map, poiMode);
    } catch (e) {
      console.error("[map] theme:", e instanceof Error ? e.message : e); // a style without these layers (fallback tiles): the map still works
    }
  }, [theme, poiMode, satellite, ready, styleGen]);

  // ── Navigation: the route lines ─────────────────────────────────────────────────────────────────────────────────
  const navAlong = nav?.progress ? Math.round(nav.progress.alongM / 5) : null; // redraw the split every ~5 m of progress, not on every wobble
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    drawNavRoutes(map, { phase: nav?.phase ?? "idle", routes: nav?.routes ?? [], selectedId: nav?.selectedId ?? null, alongM: nav?.progress?.alongM ?? null, alternatives: nav?.alternatives ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nav.progress is represented by navAlong
  }, [nav?.phase, nav?.routes, nav?.selectedId, nav?.alternatives, navAlong, ready, styleGen]);

  // Route time badges ("12 min", "+8 min"): in the chooser, and for other routes offered WHILE navigating.
  // Only the chooser frames the routes; while you navigate the camera is never moved by this.
  useEffect(() => {
    const map = mapRef.current;
    badgeMarkers.current.forEach((m) => m.remove());
    badgeMarkers.current = [];
    if (!map || !ready || !nav) return;
    const choosing = nav.phase === "choosing";
    const current = nav.routes.find((r) => r.id === nav.selectedId) ?? nav.routes[0];
    const list = choosing ? nav.routes : nav.phase === "navigating" && nav.alternatives.length > 0 && current ? [current, ...nav.alternatives] : [];
    if (list.length === 0) return;
    const choices = choosing ? nav.choices : nav.altChoices;
    const bounds = new maplibregl.LngLatBounds();
    list.forEach((r, k) => {
      r.line.forEach((c) => bounds.extend(c));
      const idx = indexRoute(r).index;
      const mid = pointAt(idx, idx.totalM * (k === 0 ? 0.5 : 0.35 + 0.1 * k));
      const c = choices.find((x) => x.id === r.id);
      const selected = r.id === (current?.id ?? nav.selectedId);
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = selected && !choosing ? "Current" : c ? (c.deltaMin === 0 ? `${c.minutes} min` : `${c.deltaMin > 0 ? "+" : ""}${c.deltaMin} min`) : "";
      el.setAttribute("aria-label", c ? `${c.title}${c.via ? ` ${c.via}` : ""}, ${c.minutes} minutes` : "Route");
      el.style.cssText = `font:700 13px system-ui,sans-serif;padding:6px 10px;min-height:32px;border-radius:16px;border:2px solid ${selected ? "#1a73e8" : "#70757a"};background:${selected ? "#1a73e8" : "#fff"};color:${selected ? "#fff" : "#3c4043"};box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer`;
      el.addEventListener("click", () => selectRef.current?.(r.id));
      badgeMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([mid.lng, mid.lat]).addTo(map));
    });
    if (choosing && !bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 90, bottom: 260, left: 40, right: 40 }, duration: 600, maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on these fields of `nav`, not on its identity (a new object every render)
  }, [nav?.phase, nav?.routes, nav?.selectedId, nav?.choices, nav?.alternatives, nav?.altChoices, ready]);

  // ── Navigation: 3D driver camera + the puck, animated on requestAnimationFrame ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !navigating) return;
    const { el, setHeadingKnown } = createPuck();
    puckHandle.current = { setHeadingKnown };
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" });
    let placed = false;
    const cam = new NavCamera(map, (c) => {
      marker.setLngLat([c.lng, c.lat]);
      marker.setRotation(c.bearing);
      if (!placed) { marker.addTo(map); placed = true; }
    });
    cam.setFollowing(followRef.current);
    map.setPadding({ top: Math.round(map.getContainer().clientHeight * 0.35), bottom: 0, left: 0, right: 0 }); // the puck sits in the lower third, the road ahead fills the rest
    cam.start();
    camRef.current = cam;
    return () => {
      cam.stop();
      camRef.current = null;
      puckHandle.current = null;
      marker.remove();
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    };
  }, [navigating, ready]);

  // Each GPS fix gives the camera a new goal; the loop above glides to it.
  useEffect(() => {
    const p = nav?.puck;
    if (!navigating || !p || !camRef.current) return;
    // Zoom changes only when speed moves into a different band (steps of 0.25), so the view doesn't keep creeping.
    const z = Math.round(navZoom(nav?.speedKmh ?? null) * 4) / 4;
    puckHandle.current?.setHeadingKnown(p.headingKnown);
    if (Math.abs(z - zoomTarget.current) >= 0.25) zoomTarget.current = z;
    camRef.current.setTarget({ lng: p.lng, lat: p.lat, bearing: headingUp ? (p.bearing ?? 0) : 0, zoom: zoomTarget.current, pitch: headingUp ? NAV_PITCH : 30 });
  }, [navigating, nav?.puck, nav?.speedKmh, headingUp]);

  // The destination is ALWAYS marked on the map while directions are active.
  useEffect(() => {
    const map = mapRef.current;
    targetMarker.current?.remove();
    targetMarker.current = null;
    const t = nav?.target;
    if (!map || !ready || !t || !["choosing", "navigating", "arrived"].includes(nav?.phase ?? "")) return;
    const el = routePin("dest");
    el.setAttribute("title", `Destination: ${t.name}`);
    targetMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([t.lng, t.lat]).addTo(map);
    return () => { targetMarker.current?.remove(); targetMarker.current = null; };
  }, [nav?.target, nav?.phase, ready]);

  // "Overview": you + the destination + the road, in one view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !viewRequest) return;
    const bounds = new maplibregl.LngLatBounds();
    if (nav?.puck) bounds.extend([nav.puck.lng, nav.puck.lat]);
    if (nav?.target) bounds.extend([nav.target.lng, nav.target.lat]);
    const sel = nav?.routes.find((r) => r.id === nav.selectedId) ?? nav?.routes[0];
    sel?.line.forEach((c) => bounds.extend(c));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, duration: 900, pitch: 0, bearing: 0, maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a NEW request (n) should trigger this
  }, [viewRequest?.n]);

  // "Re-centre": always the CURRENT position, always resumes following, glides from the view the traveller left.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !recenter) return;
    const L = latest.current;
    const here = L.puck ?? (L.me ? { lat: L.me.lat, lng: L.me.lng, bearing: null as number | null } : null);
    if (!here) return;
    if (L.navigating && camRef.current) {
      const z = Math.round(navZoom(L.speed) * 4) / 4;
      zoomTarget.current = z;
      camRef.current.recenter({ lng: here.lng, lat: here.lat, bearing: L.headingUp ? (here.bearing ?? map.getBearing()) : 0, zoom: z, pitch: L.headingUp ? NAV_PITCH : 30 });
    } else {
      const acc = L.me?.accuracyM ?? null;
      const z = zoomForAccuracy(acc);
      map.easeTo({ center: [here.lng, here.lat], zoom: (acc ?? Infinity) > 150 ? z : Math.max(map.getZoom(), z), duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a NEW command (n) is the only trigger
  }, [recenter?.n]);

  // Compass: drawn by hand on the DOM every rotation, so React never re-renders per frame.
  useEffect(() => {
    const map = mapRef.current;
    const btn = compassRef.current;
    if (!map || !ready || !btn) return;
    const ring = btn.querySelector<HTMLElement>("[data-ring]");
    const dir = btn.querySelector<HTMLElement>("[data-dir]");
    const NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const update = () => {
      const b = ((map.getBearing() % 360) + 360) % 360; // the direction the top of the screen faces
      if (ring) ring.style.transform = `rotate(${-b}deg)`;
      const name = NAMES[Math.round(b / 45) % 8];
      if (dir) dir.textContent = name;
      btn.setAttribute("aria-label", `Compass: the top of the map faces ${name}. Tap to ${latest.current.navigating ? "switch between heading-up and north-up" : "face north"}.`);
    };
    update();
    map.on("rotate", update);
    return () => { map.off("rotate", update); };
  }, [ready]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center bg-sky p-6 text-center text-sm text-ink-muted">
        The map couldn&apos;t start on this device (WebGL is unavailable). Your itinerary still works.
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <div ref={container} role="img" aria-label="Map of your trip stops. The list beside it has the same information." className="h-full w-full" />
      <button
        ref={compassRef}
        type="button"
        onClick={() => { if (latest.current.navigating && followRef.current) compassCb.current?.(); else mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 }); }}
        className="absolute right-3 top-1/2 z-10 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-white/95 shadow-md"
      >
        <span data-ring className="absolute inset-1 will-change-transform" aria-hidden="true">
          <svg viewBox="0 0 48 48" className="h-full w-full">
            <circle cx="24" cy="24" r="21" fill="none" stroke="#cbd5d1" strokeWidth="1.5" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="24" y1="4" x2="24" y2={a % 90 === 0 ? 8 : 6.5} stroke="#94a3a0" strokeWidth="1.5" transform={`rotate(${a} 24 24)`} />)}
            <text x="24" y="15.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#d93025">N</text>
            <text x="38.5" y="27" textAnchor="middle" fontSize="8" fontWeight="600" fill="#3c4043">E</text>
            <text x="24" y="42" textAnchor="middle" fontSize="8" fontWeight="600" fill="#3c4043">S</text>
            <text x="9.5" y="27" textAnchor="middle" fontSize="8" fontWeight="600" fill="#3c4043">W</text>
          </svg>
        </span>
        <span aria-hidden="true" className="absolute -top-1 h-0 w-0 border-x-[5px] border-b-[8px] border-x-transparent border-b-[#1a73e8]" />
        <span data-dir aria-hidden="true" className="relative text-[11px] font-bold text-pine" />
      </button>
    </div>
  );
}
