# Update 55: arrival, alerts, tolls, vehicle, live visuals

**Run on the dev container, 2026-10-14:** `tsc --noEmit` clean · `eslint` clean · `vitest` all pass (see the numbers in the hand-over note) · `next build` succeeded. Screens were checked in a real headless Chromium at 390 px with fixture data.
**Not verified:** a real phone, real GPS, live OpenStreetMap/OSRM/Overpass calls, the production database. **No migration needed.**

## What was added
| Feature | Where | How it stays honest |
|---|---|---|
| **Smart arrival detection** | `lib/trip/arrival.ts`, `lib/client/use-arrival.ts`, `use-visits.ts`, `visit-queue.ts`, `components/ArrivalCard.tsx`, `LiveArrival.tsx` | It only ASKS. A stop is marked only when the traveller says yes. Needs: real GPS (not a picked place), 75 m or better, inside the place's geofence (bigger for forts/lakes/treks), not at driving speed, and a stay of 20 s+. Dismissals are remembered; a confirmed stop is never asked again; earlier stops are only OFFERED as skipped. Works with no signal: the answer is kept on the phone and sent later. |
| **Alerts** | `lib/alerts/*`, `lib/client/use-alerts.ts`, `alert-channels.ts`, `components/AlertCenter.tsx`, `public/sw.js` | In-app cards plus phone notifications (permission only requested from a tap), optional tone and buzz, quiet hours, no repeats, a cap of 3 phone notifications per 10 min. Works while Trailmate is open; phones pause pages when locked, and the settings say so. |
| **Toll alerts** | `lib/trip/toll.ts`, `lib/providers/tolls-overpass.ts`, `app/api/tolls/route.ts`, `lib/client/use-tolls.ts`, `components/LiveTolls.tsx` | Plazas come from OpenStreetMap. The warning gives the MEASURED distance, never a promised "5 km", and stays silent if GPS, route or position is unreliable. A fee is shown only if the map has one, exactly as written, and only for your vehicle. |
| **Vehicle mode** | `lib/vehicle.ts`, `routing-osrm.ts`, `/api/directions`, `VehicleSelector.tsx`, `components/map/puck.ts` | Car, motorcycle, bus. Motorcycle asks the router to avoid motorway-class roads; if it cannot, the route is labelled a car route. Bus is a car route with a plain statement of what is NOT checked. The map marker is drawn as your vehicle and moves only with real GPS. |
| **Live visuals** | `components/TripProgress.tsx`, `WeatherScene.tsx`, `lib/travel/weather-scene.ts` | Progress moves only when a stop changes state. Rain falls only if rain is expected THIS HOUR (a chance alone is not rain); heat and cold only at real extremes; no wind picture because the live data has no wind speed. Switchable, and still for reduced motion. |

## Limits and what needs approval
- **No background push.** Alerts when the app is closed or the screen is locked need a push server, a database table and a notification key.
- **Tolls use the public Overpass server once per route** (cached 24 h, rate-limited, quota). For real traffic, toll plazas belong in the POI tile store, which needs a database change (new kind and group). Not done.
- **Vehicle is saved per phone.** Sharing it with the trip needs a database column.
- **Bus and motorcycle routing** beyond "avoid expressways" needs a routing service you approve.
- Thresholds (75 m, 20 s, 25 km/h, geofence sizes, toll warning distances) are engineering judgement, not measured on real trips. Try them on real drives.
