// Natural groups of places, by ROAD time (not radius): two places 30 km apart as the crow flies but 2 h by road are NOT a cluster.
// Average-linkage agglomerative clustering on the driving-time matrix; deterministic.
import { CLUSTER_LINK_MIN } from "./config";
import type { Ctx } from "./model";
import type { Cluster } from "./types";

export type ClusterMap = { clusters: Cluster[]; clusterOf: Map<number, string> };

export function findClusters(ctx: Ctx, linkMin: number = CLUSTER_LINK_MIN): ClusterMap {
  const n = ctx.places.length;
  const sym = (a: number, b: number) => (ctx.dur(a, b) + ctx.dur(b, a)) / 2;
  let groups: number[][] = Array.from({ length: n }, (_, i) => [i + 1]);

  for (;;) {
    let best: { i: number; j: number; d: number } | null = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let sum = 0, span = 0;
        for (const a of groups[i]) for (const b of groups[j]) { sum += sym(a, b); span = Math.max(span, sym(a, b)); }
        const avg = sum / (groups[i].length * groups[j].length);
        // merge only if the group would stay compact: everything within ~1.6× the link distance of each other
        const merged = [...groups[i], ...groups[j]];
        let diameter = 0;
        for (const a of merged) for (const b of merged) if (a < b) diameter = Math.max(diameter, sym(a, b));
        if (avg <= linkMin && diameter <= linkMin * 1.6 && (!best || avg < best.d - 1e-9)) best = { i, j, d: avg };
      }
    }
    if (!best) break;
    groups = groups.flatMap((g, k) => (k === best!.i ? [[...g, ...groups[best!.j]].sort((a, b) => a - b)] : k === best!.j ? [] : [g]));
  }

  const clusters: Cluster[] = [];
  const clusterOf = new Map<number, string>();
  for (const g of groups.filter((x) => x.length >= 2)) {
    // the centre = the place with the least total road time to the others
    const center = [...g].sort((a, b) => g.reduce((s, x) => s + sym(a, x), 0) - g.reduce((s, x) => s + sym(b, x), 0) || a - b)[0];
    const names = [center, ...g.filter((x) => x !== center)].map((i) => ctx.places[i - 1].name);
    const label = g.length === 2 ? `${names[0]}–${names[1]} area` : `${names[0]} area (${g.length} places)`;
    let spanMin = 0;
    for (const a of g) for (const b of g) if (a < b) spanMin = Math.max(spanMin, sym(a, b));
    const id = `c${center}`;
    for (const i of g) clusterOf.set(i, id);
    const lat = g.reduce((s, i) => s + ctx.places[i - 1].lat, 0) / g.length;
    const lng = g.reduce((s, i) => s + ctx.places[i - 1].lng, 0) / g.length;
    clusters.push({
      id, label, placeIds: g.map((i) => ctx.places[i - 1].id), centerId: ctx.places[center - 1].id, spanMin: Math.round(spanMin), centroid: { lat, lng },
      fromStart: { dir: ctx.dir(0, center), km: Math.round(ctx.km(0, center)), driveMin: Math.round(ctx.dur(0, center)) },
    });
  }
  clusters.sort((a, b) => a.fromStart.driveMin - b.fromStart.driveMin || a.id.localeCompare(b.id));
  return { clusters, clusterOf };
}
