// Splitting one route into days. NOT greedy: dynamic programming finds the split into exactly K days that keeps every day
// within its limits and spreads the load evenly, while avoiding cutting a natural cluster across two days.
import { CLUSTER_SPLIT_PENALTY } from "./config";
import { dayFits, returnNode } from "./loads";
import type { Ctx } from "./model";

/** `order` = matrix nodes in route order. Returns the days (arrays of nodes) or null when no split satisfies every limit. */
export function partitionDays(ctx: Ctx, order: number[], numDays: number, clusterOf: Map<number, string>): number[][] | null {
  const m = order.length;
  if (m === 0) return [];
  const K = Math.min(Math.max(1, numDays), m);
  const cap = ctx.style.capacityMin;
  const ret = returnNode(ctx);

  // prefix sums over the route: leg into each stop, visit+buffer at each stop
  const leg: number[] = [0], vb: number[] = [0];
  for (let k = 1; k <= m; k++) {
    const prev = k === 1 ? 0 : order[k - 2];
    leg.push(leg[k - 1] + ctx.driveMin(prev, order[k - 1]));
    vb.push(vb[k - 1] + ctx.visitMin(order[k - 1]) + ctx.bufferMin);
  }
  const returnLeg = ret !== null ? ctx.driveMin(order[m - 1], ret) : 0;

  const dayCost = (i: number, j: number): number | null => {
    const drive = leg[j] - leg[i - 1] + (j === m ? returnLeg : 0);
    const load = drive + vb[j] - vb[i - 1];
    if (!dayFits(ctx, drive, load, i === j).ok) return null;
    return (load / cap) ** 2;
  };
  const cut = (j: number) => {
    const a = clusterOf.get(order[j - 1]), b = clusterOf.get(order[j]);
    return a !== undefined && a === b ? CLUSTER_SPLIT_PENALTY : 0;
  };

  const INF = Number.POSITIVE_INFINITY;
  const f: number[][] = Array.from({ length: K + 1 }, () => new Array(m + 1).fill(INF));
  const from: number[][] = Array.from({ length: K + 1 }, () => new Array(m + 1).fill(0));
  f[0][0] = 0;
  for (let k = 1; k <= K; k++) {
    for (let j = k; j <= m; j++) {
      for (let i = k; i <= j; i++) {
        if (f[k - 1][i - 1] === INF) continue;
        const c = dayCost(i, j);
        if (c === null) continue;
        const total = f[k - 1][i - 1] + c + (j < m ? cut(j) : 0);
        if (total < f[k][j] - 1e-9) { f[k][j] = total; from[k][j] = i; }
      }
    }
  }
  if (f[K][m] === INF) return null;
  const days: number[][] = [];
  let j = m;
  for (let k = K; k >= 1; k--) { const i = from[k][j]; days.unshift(order.slice(i - 1, j)); j = i - 1; }
  return days;
}
