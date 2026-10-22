// SERVER ONLY. Loads data/geo/india-places.json.gz once per server instance (about 70k places, ~1 MB on disk) and keeps it in memory.
// The file ships with the server build through `outputFileTracingIncludes` in next.config.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { buildIndex, type GeoIndex, type GeoIndexData } from "./geo-index";

// The ignore comments stop the bundler from tracing the whole project because of a path built at run time; the one file needed is
// shipped explicitly by `outputFileTracingIncludes` (next.config.ts), and tests/places-geo-index.test.ts loads it.
export const GEO_INDEX_FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "geo", "india-places.json.gz");

let loading: Promise<GeoIndex | null> | null = null;

/** The index, or null if the file is missing or damaged (search then falls back to the map search and says so). Never throws. */
export function loadGeoIndex(file = GEO_INDEX_FILE): Promise<GeoIndex | null> {
  if (!loading) {
    loading = readFile(/* turbopackIgnore: true */ file)
      .then((buf) => buildIndex(JSON.parse(gunzipSync(buf).toString("utf8")) as GeoIndexData))
      .catch((err) => {
        console.error("[places] India place index unavailable:", err instanceof Error ? err.message : err);
        loading = null; // try again on the next request
        return null;
      });
  }
  return loading;
}
