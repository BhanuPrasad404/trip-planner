# Trailmate — Trip Intelligence architecture

## 0. Product structure (what each page is for)

| Page | Question it answers | Notes |
|---|---|---|
| `/dashboard` | What's happening, what next, what needs attention? | One focus trip, real attention items, recent memories, travel style |
| `/trips` | All my trips | Active / Upcoming / Drafts / Completed, one obvious action per trip |
| `/trips/[id]` | Where is this trip at? | Hero by lifecycle state, itinerary at a glance, who/how you travel (trip type, range), invite/share |
| `/trips/[id]/plan` | Build the itinerary | Import, Auto-plan, votes, community updates, Go Score, season/weather alerts |
| `/trips/[id]/live` | What should I do next? | Next best action (Autopilot), trip health, Travel Radar, Up next, Live Place Pulse, drive controls |
| `/trips/[id]/map` | Full-screen intelligent map | Layers (radar / all places), radar sheet, live friends, road to next stop |
| `/trips/[id]/explore`, `/explore` | What's worth doing, and when? | In-season places from our curated data + real nearby places |
| `/trips/[id]/memories`, `/memories` | What actually happened? | Plan vs Reality, own photos, factual trip story |
| `/profile` | Me | Travel style learned from my trips, privacy, setup check |

The five systems share one engine (`lib/intel`): **Autopilot** (advisor + undoable actions), **Travel Radar** (route-corridor ranking → `radar`),
**Live Place Pulse** (`pulse.ts`, trust-labelled signals + conflicts), **Smart Stops** (`smart-stops.ts`, now using real continuous-driving time),
**Plan vs Reality** (`lib/learning.ts`, computed from what the person marked done/skipped — no extra tables, no location history).

Every plan change goes through `useTripActions`: explicit, explained, and undoable (`/api/trips/[id]/restore`).

Trailmate is not "a map with a list". Once a trip starts, the plan is **living**: it reads where you are, which way you are heading,
the road ahead, the time, the weather and who you are travelling as — and keeps answering *"what should I do next?"*.

## 1. The shape of the system

```
 Browser (Next.js client)                     Server (Next.js route handlers)                      Data
 ───────────────────────                     ───────────────────────────────                      ────
 GPS (watchPosition)  ──► use-drive ──────►  POST /api/eta       ─► RoutingProvider ──► OSRM*        (road, legs, ETA)
        │                    │
        │                    └─ shares (opt-in) ─► live_locations (Supabase Realtime) ◄── friends
        ▼
 use-intel (asks only when it matters)  ───► POST /api/intel
                                               1. road ahead      ─► RoutingProvider                 (or reuses the client's)
                                               2. places          ─► PoiService ─► PoiStore ──► PostGIS `pois` (OUR data)
                                                                          │            ▲
                                                                          └─ cache miss: PlacesProvider ──► Overpass* (per TILE, once)
                                               3. weather         ─► WeatherProvider ─► Open-Meteo*  (hourly, cached 30 min)
                                               4. community       ─► place_reports (fresh photos/updates)
                                               5. THINK           ─► buildIntel()  (pure, no I/O)
                                             ◄── Smart Stops · advice · what's ahead · photos · coverage
 IntelPanel + map markers + Drive panel                                                          (* = swappable provider)
```

## 2. Rules the design follows

1. **No public map server per user request.** Places live in our own PostGIS table. A provider is asked **once per map tile** (zoom-10, ≈38 km),
   the result is classified and stored, and every later request is a spatial query on our database.
   Tiles are filled on demand (nearest-ahead first, at most 2 while you wait, the rest after the response) or in bulk (`scripts/ingest-region.mjs`).
2. **Products talk to interfaces, not vendors.** `lib/providers/types.ts` defines `RoutingProvider`, `PlacesProvider`, `WeatherProvider`,
   `GeocodingProvider`. `lib/providers/registry.ts` is the only place that picks a vendor (env variables).
3. **Intelligence is pure.** `lib/intel/*` takes plain data in and returns plain data out. No network, no database → fast, deterministic, fully tested.
4. **Never claim what we have not mapped.** "No fuel found" is only said when every tile of the mapped corridor is ingested; otherwise the UI says it is still mapping.
5. **Honest data.** Opening hours we cannot parse are "unknown", never guessed. Photos are real (community / the place's own Wikimedia photo) or absent.
6. **Privacy by default.** Location sharing is opt-in per person; one row per person; stopping deletes it; rows older than 6 h are invisible; positions sent to `/api/intel`, `/api/eta`, `/api/nearby` are not stored.

## 3. Swapping a vendor (no product code changes)

| Capability | Interface | Default | To replace |
|---|---|---|---|
| Routing + ETA | `RoutingProvider` | OSRM | write `lib/providers/routing-mapbox.ts`, `registerProvider("routing", …)`, set `ROUTING_PROVIDER=mapbox` |
| Places (POIs) | `PlacesProvider` | OpenStreetMap / Overpass | implement `fetchPlaces(bbox, group)` for Foursquare / Google Places / HERE; rows keep their `source`, so providers can coexist |
| Weather | `WeatherProvider` | Open-Meteo | implement `hourly()` + `conditionsFor()` (Tomorrow.io, IMD, …) |
| Geocoding (search box) | `GeocodingProvider` | Nominatim | MapTiler / Mapbox / Google |
| Map tiles | MapLibre style URL | OSM raster | `NEXT_PUBLIC_MAP_STYLE_URL` |

Production scale: self-host Overpass (`OVERPASS_URL`) and OSRM (`OSRM_BASE_URL`), or use paid equivalents — still no code change.

## 4. Data model (migration `20261010000000_poi_store_and_trip_prefs.sql`)

- `pois (source, source_id, kind, name, lat, lng, geog GENERATED geography(Point), tags jsonb, fetched_at)` — GiST index on `geog`.
- `poi_tiles (tile_key, grp, status, poi_count, fetched_at)` — which (tile, group) we have; failed tiles back off for 10 min; data is refreshed after 45 days (stale data keeps serving meanwhile).
- `pois_in_corridor(line, buffer_m, kinds, limit)` — "places within N m of this road" (PostGIS `ST_DWithin` on the route).
- `pois_near(lat, lng, radius_m, kinds, limit)`.
- Writes only with the service-role key; signed-in users can only read.
- `trips.trip_type`, `trips.vehicle_range_km` — personalisation (owner edits).
- Other tables: `place_reports` (fresh community updates + photos), `live_locations` (opt-in live position), `places.status` (trip progress).

## 5. How the engine decides (all in `lib/intel`)

- **route-geometry** — position along the road, distance to the side, "behind you" vs "ahead".
- **ranking** — score = proximity (per-kind scale: fuel matters 35 km out, parking 5 km) · detour time · open **at the time you would arrive** · quality signals · fresh community updates,
  then × trip-type weight (family → restrooms/hospitals; biker → fuel/repair/viewpoints; couple → viewpoints/cafes …) × weather fit (rain at arrival lowers viewpoints, lifts cafes). Every score has plain-language reasons.
- **smart-stops** — fuel *gaps* vs the vehicle's range (we do not guess the tank level), meal windows (breakfast/lunch/dinner) only when a good place is reachable inside them,
  a break after ~2 h of driving, a bed when you will arrive after ~21:00, a sunset viewpoint you can still reach in daylight, strong sights close to the road when the day has slack.
- **advisor** — behind plan (offers *Re-plan from now*), will not finish by the day's end (names the stops that cost most for least, offers *Skip*),
  rain / heat / darkness at each outdoor stop **at its arrival time**, with a dry alternative when one exists.
- **hours / sun** — a careful `opening_hours` reader (unsupported syntax → "unknown") and NOAA sunrise/sunset.
- Nothing changes your plan by itself: every action (re-plan, skip) is a suggestion you confirm.

## 6. Scaling path

| Stage | Change |
|---|---|
| Now | Supabase PostGIS + service key; OSM via public Overpass for tile fills; pre-load your launch states with the ingest script |
| Launch | Self-hosted Overpass/OSRM (or paid); paid map tiles; CDN-cached tile style |
| Growth | Move in-memory caches (weather, commons) to Redis/Upstash; queue tile ingestion (Supabase Queues / cron) instead of `after()`; partition `pois` by region if it passes ~50 M rows |
| Later | A second `PlacesProvider` (ratings/photos), per-user history for learning preferences, offline corridor packs |

## 7. Ideas that would make Trailmate genuinely different (proposals, not built yet)

1. **Convoy mode** — friends drift apart on highways: "Arjun is 14 km behind, 18 min", a regroup point (next fuel/food ahead of both), and per-friend ETA to the next stop.
2. **Safety link** — a read-only, expiring live link for family at home ("Anita's trip: 62 km to Kondapalli, arriving 14:10").
3. **Road-condition layer** — reports tagged to road segments (closure, potholes, landslide, flooding) that reroute/warn ahead; the same `place_reports` model with a line geometry.
4. **Offline corridor pack** — download the next 150 km (places + tiles) before the ghats where there is no signal.
5. **Weather-window planning** — reorder stops so rain-sensitive places fall in the dry hours (needs the planner to take hourly weather as a constraint).
6. **Trip cost** — fuel + tolls from distance, mileage and local prices, split between the group (UPI).
7. **Verified freshness** — read photo EXIF time/location to mark updates "verified on site", and rank them above unverified ones.
8. **Best-time-to-visit crowd curves** — from community tags (crowded/quiet) by hour and weekday.
9. **Auto trip recap** — route + best photos + places, shareable.
10. **Fuel level input** — one tap "tank is ¼" to turn range gaps into exact warnings (EV: charger availability and charging time).
