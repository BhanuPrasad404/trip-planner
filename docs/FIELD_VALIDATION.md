# Field validation: what is proven by tests, and what only a real drive can prove

Status words: **AUTO** = an automated test exercises the logic (with fakes). **DEVICE** = needs a real phone on a real road. **LIVE** = needs the real external service.
Nothing below has been checked on a device or against live services unless a row says a person did it. No row does.
All numbers are engineering judgement from the code (`lib/trip/arrival.ts`, `lib/trip/toll.ts`, `lib/map/navigation.ts`, `lib/location/*`), not measured on trips.

## Thresholds under review
| Behaviour | Value(s) | Where | Why it might be wrong | AUTO | DEVICE / LIVE still owed |
|---|---|---|---|---|---|
| Ask "have you arrived?" | accuracy ≤ 75 m, ≥ 2 fixes over ≥ 20 s inside the geofence, speed ≤ 25 km/h, fix ≤ 30 s old; dismissed → re-ask only after 2× radius away | `ARRIVAL` | 20 s may be long at a quick photo stop; 75 m accuracy is rare in canyons/forts | `trip-arrival.test.ts`, `arrival-flow.test.tsx` | walk/drive to 5 real stops of different kinds; log prompt time vs. real arrival |
| Geofence radius by kind | food/stay 100 m · viewpoint/temple/museum/other 150 · fort/waterfall/activity 300 · lake/beach 400 · trek 500 · wildlife/hill station 800 m | `RADIUS_M` | A hill-station pin is a town centre: 800 m may prompt while merely passing; a pin 400 m from a fort's gate would never prompt | same | compare pin-to-entrance distance for 10 real places |
| Navigation "arrived" | ≤ 30 m from the end AND ≤ 50 m sideways | `ARRIVE_RADIUS_M`, `ARRIVE_OFFSET_M` | Pins on large sites sit far from the road end | `navigation.test.ts`, `audit52-navigation.test.ts` | real approach to a gate, a parking lot, a ghat road |
| Off route | > max(25 m, 1.5× GPS error), 3 bad fixes over ≥ 3 s, never re-route within 10 s; fix > 100 m error = say nothing | `OFF_ROUTE` | Parallel roads, flyovers, service roads | `nav-scenario.test.tsx` (timing-sensitive, flaked once under load) | drive a flyover section and a missed turn |
| Impossible jump | > 70 m/s (≈ 250 km/h) between fixes is rejected | `MAX_PLAUSIBLE_MS` | Fine for road trips; a train is rejected | `fix-filter.test.ts` | ride a train once to see the behaviour |
| GPS grade | good ≤ 50 m, fair ≤ 150, rough ≤ 1 km; stale > 30 s | `lib/location/quality.ts` | Indoor/urban canyon behaviour unknown | `fix-filter.test.ts` | urban + mountain drive |
| Toll warning distance | speed ≥ 40 km/h → 5 km ahead; 15–40 → 3 km; slower → 1.5 km; closer than 50 m = too late; passed at 300 m; plaza ≤ 60 m from the road (server looks within 80 m) | `TOLL` | 5 km is ~3 min at 100 km/h; plazas on parallel service roads may be matched | `trip-toll.test.ts`, `live-tolls.test.tsx`, `tolls-route.test.ts` | drive 3 real toll plazas; compare the stated distance to the odometer |
| Toll data | OpenStreetMap `barrier=toll_booth` / `highway=toll_gantry`, public Overpass, cached 24 h, ≤ 8 chunks of 250 points | `tolls-overpass.ts` | Indian OSM toll coverage and fee tags are unknown; fees shown only if tagged | `tolls-route.test.ts` (fakes; "nothing checked" is an error, never "no tolls") | **LIVE**: one real route on a national highway; count plazas vs. reality |
| Season-data matching | name words + type + ≤ 25 km | `MAX_MATCH_KM` | Coordinates are ~10 km approximate | `season-match.test.ts` | pin-check script in `TESTING_WITH_FRIENDS.md` |
| Opening-hours lookup | name + distance match, ambiguous → nothing saved | `hours-match.ts` | OSM hours sparse for Indian sights; temples tagged only `amenity=place_of_worship` are not stored | `opening-hours*.test.ts`, `hours-routes.test.ts` | **LIVE**: 10 real places |
| Routing/ETA | public OSRM, car speeds, no traffic; refresh after 1 km or 90 s | `use-drive.ts` | Free service limits; no live traffic | `use-drive.test.tsx`, `eta*.test.ts` | **LIVE**: compare 3 ETAs to real arrival |
| Offline detection (new) | 2 failed probes of 4 s to flip; heartbeat 60 s; retry 2–30 s | `connectivity.ts` | Real mobile networks flap; 4 s may be short on bad 2G | `connectivity.test.ts` | toggle airplane mode; drive through a dead zone; tether to a hotspot with no data |

## Drive checklist (about 90 minutes, two people, one driving)
1. Airplane mode on/off on the Plan page: banner appears within a second, "Try again" works, "Back online" shows, data refreshes. Then a hotspot with data switched off (Wi-Fi up, internet down): banner appears within ~65 s with no tap.
2. Open the app with airplane mode already on, then reload a page: the offline page appears (needs HTTPS or localhost for the service worker).
3. Start a drive on a 3-stop trip; at each stop write down when the arrival prompt appeared and where you really were.
4. Drive past one toll plaza at highway speed and one in town: note the warning distance shown vs. odometer.
5. Take a deliberate wrong turn: how long until a new route, and was it a false alarm anywhere before?
6. Describe my trip: use a real brief with your own limits; check each "left out" reason against your own judgement; time the drive of day 1 vs. the stated driving.
Record results in this file (date, device, browser, result). Until then every DEVICE/LIVE cell above is unverified.
