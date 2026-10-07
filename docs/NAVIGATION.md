# Map theming + turn-by-turn navigation (update 19)

## What exists
| Piece | File | Notes |
|---|---|---|
| Themes (Light / Dark / High-contrast), POI control, zoom detail, 3D buildings, satellite underlay, SVG icons | `lib/map/theme-config.ts` | One engine, colours are data. Switching = `setPaintProperty` on the live map (no reload). Pure patch computation is unit-tested against real OpenFreeMap Liberty layer ids. |
| Basemap + fallback | `lib/map/style.ts` | OpenFreeMap Liberty by default; any style URL via `NEXT_PUBLIC_MAP_STYLE_URL`; OSM raster fallback if the style can't load in 12 s. |
| Directions (steps, alternatives) | `lib/map/directions.ts`, `lib/providers/routing-osrm.ts`, `POST /api/directions` | Instructions are generated from maneuver data (never AI). Alternatives = OSRM `alternatives=2` (OSRM only offers them between two points, so navigation is "here → next stop"). |
| Progress, banner text, ETA, off-route, split line, smoothing | `lib/map/navigation.ts` | Pure + tested. |
| State machine (preview → choose → navigate → reroute → arrive) | `lib/client/use-navigation.ts` | Reacts to GPS fixes in a callback, not in effects. |
| Map layers (blue line, grey passed, grey alternatives), 3D camera, puck | `components/TripMap.tsx`, `components/map/*` | rAF loop glides puck + camera between fixes; React never re-renders per frame. |
| Overlay UI | `components/map/NavigationOverlay.tsx`, `MapThemeControl.tsx` | Route cards, turn banner, ETA bar, voice toggle. |

## Rules
- **Off route** = further than max(25 m, 1.5 × GPS error) for ≥3 fixes over ≥3 s, at most one reroute per 10 s. A fix vaguer than 100 m pauses guidance instead of guessing.
- **ETA** = routing-provider durations at typical speeds. Live traffic is NOT connected and the UI says so.
- **Camera**: pitch 50°, zoom 17 easing to 15.5 at highway speed, bearing = road direction when moving.

## Not Google-identical (on purpose / by limits)
- No live traffic, lane guidance, speed limits or junction views (no free data source wired in).
- Instructions are English; voice uses the browser's speech engine.
- MapLibre has no `smoothTileTransform`; real options used: `fadeDuration: 100`, `cancelPendingTileRequestsWhileZooming`. MapLibre already parses tiles in web workers.
- 3D buildings get directional shading (`setLight`), not cast shadows.
- The puck is pitch-aligned 2.5D (a true 3D model would need a three.js layer).
- Custom fonts (Inter/Roboto) need glyph PBFs on your glyph server; `fontStack` exists, default keeps the style's Noto Sans.
- A phone BROWSER stops GPS when the screen locks. Real in-car navigation needs the app installed as a PWA/native wrapper; Drive mode already keeps the screen awake.
- Public OSRM demo and the OpenFreeMap public server are "as-is": self-host or use a paid router/tiles before launch.

## Update 20 — Drive now = real route from where you really are
- **Drive now arms navigation.** Once the drive is confirmed and the position is precise, the road route from your REAL position to the next stop is fetched and followed by itself (alternatives are one tap away: "Other routes"). Moving to the next stop restarts it automatically. "End" stops it and it does not restart.
- **Planned vs actual start.** Hyderabad stays the planned start. If you are somewhere else the start card says "You're currently near Warangal … Your plan still starts in Hyderabad; this drive will start from where you are", and the panel keeps showing both. The town name comes from one reverse lookup (position rounded to ~1 km, cached, not stored).
- **No fake lines.** A straight-line estimate is never drawn as a route: if the routing service can't answer you see "Road directions are unavailable" and it retries every 15 s.
- **The camera never fights you.** ANY hand movement (drag, pinch, wheel, +/−, rotate, tilt) switches off follow; GPS keeps updating the puck, distance and ETA in the background; "Re-centre" glides back from where you left the view. The map only turns with the road while you are moving.
- **Smoothness.** Puck and camera are interpolated on requestAnimationFrame; zoom changes only when speed moves into another band.
- **Cheap routing.** Requests only at start, wrong turn (3 bad fixes over ≥3 s, ≥10 s apart), or next stop; one in flight at a time; cancelled with AbortController; late answers are discarded. One impossible GPS jump is ignored.
- **Numbers.** Remaining distance/time are measured along the route geometry from your position; the destination row adds the later road legs from the same data. No live traffic — the panel says so.
- **State model** (`lib/map/session-state.ts`): not-started → locating → confirming → waiting-for-precise-position → calculating → following | exploring → off-route → recalculating → arrived | error.
