// Driving-time matrix. The vendor is chosen in lib/providers/registry.ts (ROUTING_PROVIDER, default OSRM).
// If routing is down every provider degrades to a straight-line estimate, so planning never fails.
import type { GeoPoint } from "@/lib/geo";
import { routingProvider } from "@/lib/providers/registry";
import type { Matrix } from "@/lib/providers/types";

export type { Matrix };
export { estimateMatrix } from "@/lib/providers/estimate";

export const getMatrix = (points: GeoPoint[], fetchImpl?: typeof fetch): Promise<Matrix> => routingProvider().matrix(points, fetchImpl);
