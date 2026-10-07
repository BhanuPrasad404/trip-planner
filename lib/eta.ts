// Road route + time left from where you are through the next few stops.
// The vendor is chosen in lib/providers/registry.ts (ROUTING_PROVIDER, default OSRM).
import type { GeoPoint } from "@/lib/geo";
import { routingProvider } from "@/lib/providers/registry";
import type { RouteLeg, RouteResult } from "@/lib/providers/types";

export type { RouteLeg, RouteResult };
export { estimateRoute } from "@/lib/providers/estimate";
export { parseOsrmRoute } from "@/lib/providers/routing-osrm";

export const getRoute = (points: GeoPoint[], fetchImpl?: typeof fetch): Promise<RouteResult> => routingProvider().route(points, fetchImpl);
