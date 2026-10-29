# Place catalogue: our own database of places for all of India

Explore, "Plan it for me", "On your way" and "Places like these" read places from **our own database** (`place_catalog`), not from a
public map server during a tap. The catalogue is filled in the background from two free, open sources:

| Source | What it gives | Licence | How |
|---|---|---|---|
| **Wikidata** | What a place IS (waterfall, Jain temple, valley…), how widely it is written about (sitelinks), Wikipedia article, heritage listing, photo | CC0 | `scripts/catalog/extract-wikidata.ts` (plain HTTPS, no new tool) |
| **OpenStreetMap** (Geofabrik India extract) | Depth: every named fort, temple, waterfall, beach, park, lake, museum, viewpoint, hill, heritage site; exact positions; opening hours; websites | ODbL: credit "© OpenStreetMap contributors" | `scripts/catalog/extract-osm.ts` with **osmium** in Docker |

Every place keeps **its source and the date of that data** (`osm_date`, `wd_date`); the app shows them under each place
("OpenStreetMap, 28 Oct 2026 · Wikidata, 29 Oct 2026"). A place both sources know is ONE row (OpenStreetMap elements that link to
Wikidata are keyed by the Wikidata id). OpenStreetMap owns name, kind, position and hours; Wikidata never overwrites them.

The kind of a map place is decided by the same rules as the live map search (`lib/explore/categories.ts`), so the catalogue and a live
answer never disagree. Wikidata is asked **by place type only** (list and checked ids in `lib/catalog/wikidata.ts`), India only, and
anything that is a town, village or administrative area is left out.

## Serving order (lib/explore/service.ts → loadExplore)

1. **Catalogue loaded** → its answer is the answer. No public server is asked.
2. Catalogue has **nothing** for that question → the live Overpass map as an **extra** (unless `OVERPASS_EXTRA=off`), then saved lists,
   then the offline GeoNames list. If all of that fails, the catalogue's "nothing here" stands (never an error).
3. Catalogue **not loaded / unreadable** → the old path exactly as before.

## One-time setup (the machine that builds it)

1. Apply the migration: `supabase db push` (adds `place_catalog`, `catalog_regions`, `catalog_loads` and their functions; additive only).
2. `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server only). Optional: `GEOCODER_USER_AGENT` with a
   contact address (sent to Wikidata and Geofabrik), `CATALOG_DATA_DIR` (default `~/trailmate-data`).
3. Docker Desktop running, then build osmium once (from Debian's own package, no third-party image):
   `docker build -t trailmate-osmium -f scripts/catalog/osmium.Dockerfile scripts/catalog`

## Build and load (about 30 minutes; PowerShell or Git Bash)

```
# 1. Wikidata (a few minutes, polite: one question at a time)
npx tsx scripts/catalog/extract-wikidata.ts
# 2. OpenStreetMap: download the India extract (~1.7 GB) and check it
#    https://download.geofabrik.de/asia/india-latest.osm.pbf  (+ the .md5 next to it)
npx tsx scripts/catalog/extract-osm.ts ~/trailmate-data/osm/india-YYMMDD.osm.pbf
# 3. Load both (Wikidata first, then the map), with the folder names the steps printed
npx tsx scripts/catalog/load.ts ~/trailmate-data/wikidata-YYYY-MM-DD
npx tsx scripts/catalog/load.ts ~/trailmate-data/osm-YYYY-MM-DD
```

Each extract writes JSON batches and a `manifest.json` (counts per kind) to its folder; nothing reaches the database until `load.ts`.
A load can be run again safely (rows merge, never duplicate). Every run is logged in `catalog_loads` (`running` → `ok`/`failed`).

## What a place IS, and what it belongs to (migration 20261030000000_place_roles.sql)

Each place also keeps: `wd_type` (the Wikidata type it was found under, e.g. Q39816 valley), `osm_type` (the map tag that made it a
place, e.g. `historic=fort`), `located_in` / `located_in_name` (Wikidata P131) and `part_of` (Wikidata P361). The app uses them to tell a
city or a valley (no opening hours of its own) from a temple or a fort, and to suggest the sights in or around a town
(`lib/place-intel/role.ts`, `lib/place-intel/attractions.ts`, read through `catalog_sites`). Extracts made before this migration don't
have these fields: run both extracts again, then load them (Wikidata first). Check the result offline with
`npx tsx scripts/place-intel/roles-report.ts <osm folder> <wikidata folder>` (writes `reports/place-intel/roles.md`).

## Refreshing (monthly is plenty)

Run the same steps with a new extract, and add `--prune` to each load:
`npx tsx scripts/catalog/load.ts ~/trailmate-data/osm-YYYY-MM-DD --prune`.
Prune takes away places that source no longer has (a place the other source still has stays). It runs only after every batch loaded;
a failed load prunes nothing.

## Checking it

* Setup check → "Test my map servers" now starts with the catalogue: how many places, from which data dates, how many state borders.
* SQL: `select * from catalog_status();` and `select * from catalog_loads order by id desc limit 5;`

## What it can't promise (honest limits)

* Coverage is what OpenStreetMap and Wikidata contain. Rural and small places can be missing or unnamed there; nothing is invented.
* Opening hours are as written on the map, not checked. Wikidata dates say when we ASKED, not when the fact was last verified.
* Places from Wikidata only have no opening hours and a Wikidata position (usually good, sometimes rough).
* Storage: measure after the first load (`select pg_size_pretty(pg_total_relation_size('place_catalog'))`) against the Supabase plan.
