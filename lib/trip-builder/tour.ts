// Ordering stops on a road network: nearest-neighbour start, then 2-opt (remove crossings) and or-opt (move one stop to a
// better place in the path). Pure; the cost matrix is injected. This is the ONE ordering implementation: the old Auto-plan
// (lib/planner.ts) calls it too.
export const pathCost = (path: number[], d: number[][]): number => {
  let c = 0;
  for (let i = 1; i < path.length; i++) c += d[path[i - 1]][path[i]];
  return c;
};

/**
 * Best order to visit `nodes` starting at `start`, optionally finishing at `end`. Returns the nodes only (not start/end).
 * Deterministic: ties are broken by the lower index.
 */
export function optimizeOpenPath(args: { nodes: number[]; start: number; end?: number | null; d: number[][]; orOpt?: boolean; /** Smallest improvement worth taking, in the cost unit (default 1e-6). */ eps?: number }): number[] {
  const eps = args.eps ?? 1e-6;
  const { start, d } = args;
  const end = args.end ?? null;
  const nodes = [...args.nodes].sort((a, b) => a - b);
  if (nodes.length <= 1) return nodes;

  // 1) nearest neighbour
  const remaining = new Set(nodes);
  const path = [start];
  while (remaining.size) {
    const last = path[path.length - 1];
    let best = -1, bestD = Infinity;
    for (const j of [...remaining].sort((a, b) => a - b)) if (d[last][j] < bestD) { bestD = d[last][j]; best = j; }
    path.push(best);
    remaining.delete(best);
  }
  if (end !== null) path.push(end);
  const last = () => path.length - (end !== null ? 2 : 1); // index of the last movable node

  // 2) 2-opt with fixed start (and fixed end)
  let improved = true, passes = 0;
  while (improved && passes++ < 50) {
    improved = false;
    for (let i = 1; i < last(); i++) {
      for (let j = i + 1; j <= last(); j++) {
        const candidate = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (pathCost(candidate, d) + eps < pathCost(path, d)) {
          path.splice(0, path.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  // 3) or-opt: move one stop to the best other position
  if (args.orOpt !== false) {
    let moved = true, rounds = 0;
    while (moved && rounds++ < 20) {
      moved = false;
      for (let i = 1; i <= last(); i++) {
        const node = path[i];
        const without = [...path.slice(0, i), ...path.slice(i + 1)];
        const base = pathCost(path, d);
        let bestCost = base, bestPath: number[] | null = null;
        for (let k = 1; k <= without.length - (end !== null ? 1 : 0); k++) {
          if (k === i) continue;
          const cand = [...without.slice(0, k), node, ...without.slice(k)];
          const c = pathCost(cand, d);
          if (c + eps < bestCost) { bestCost = c; bestPath = cand; }
        }
        if (bestPath) { path.splice(0, path.length, ...bestPath); moved = true; }
      }
    }
  }
  return path.slice(1, end !== null ? -1 : undefined);
}
