// Real photos of PLACES (a temple, a fort, a waterfall), found on Wikipedia and shown only when every gate passes:
// the article is about this place (name AND location), the photo is a Commons raster that is not a map/flag/logo, and its licence is
// verified free. Best-effort: nothing here throws, and "could not check" is never reported as "no photo".
//   resolve.ts   the strategy (cache → exact title → name search → nearby articles → ranked photo choice)
//   wikimedia.ts the one polite HTTP client (throttle, retry, circuit breaker, host allow-list)
//   store.ts     the shared cache (database in production, memory otherwise)
//   safety.ts / rank.ts / match.ts   the gates, pure and unit-tested
import { resolvePlacePhotos, type ResolveResult } from "./resolve";
import { getPhotoStore } from "./store";
import { wikimedia } from "./wikimedia";
import type { PlacePhotoQuery } from "./types";

export type { FoundVia, NoPhotoReason, PlacePhoto, PlacePhotoQuery } from "./types";
export type { ResolveResult } from "./resolve";

/** Kill switch: PLACE_PHOTOS_UPSTREAM=off stops every call to Wikimedia (cached photos are still served). For an outage or a policy problem. */
export const upstreamDisabled = () => (process.env.PLACE_PHOTOS_UPSTREAM ?? "").trim().toLowerCase() === "off";

/** Production wiring: shared cache + the one Wikimedia client + the kill switch. */
export function lookupPlacePhotos(queries: PlacePhotoQuery[], opts: { allowUpstream?: () => boolean | Promise<boolean>; /** Diagnostics: ignore cached answers. */ fresh?: boolean } = {}): Promise<ResolveResult> {
  return resolvePlacePhotos(queries, {
    store: getPhotoStore(),
    skipCache: opts.fresh === true,
    get: wikimedia.getJson,
    allowUpstream: async () => !upstreamDisabled() && (opts.allowUpstream ? await opts.allowUpstream() : true),
    log: (line) => console.info(line),
  });
}

/** Health of the shared Wikimedia client in this server process (diagnostics only): calls, failures, rate limits, whether the breaker is open. */
export const upstreamStats = () => ({ ...wikimedia.stats(), breakerOpen: wikimedia.breakerOpen() });
