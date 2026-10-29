// SERVER ONLY. The offline list (lib/explore/offline.ts) over the India place index loaded once per server instance.
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { offlineExplore } from "./offline";
import type { ExploreKinds, ExploreScope } from "./query";

export async function loadOfflineExplore(scope: ExploreScope, kinds: ExploreKinds) {
  const ix = await loadGeoIndex();
  if (!ix) return null;
  return { items: offlineExplore(ix, scope, kinds), builtAt: Date.parse(ix.built) || 0 };
}
