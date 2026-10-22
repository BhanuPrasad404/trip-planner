// "What if I had N days?" — fast. The full plan (every day order tried against opening hours and sunset) takes a second or more for
// many places; this answer only needs HOW MANY places fit and how much driving, so it orders the places ONCE and then, for each N, runs
// the same day-splitting (dynamic programming) and the same "drop the least valuable per minute saved" rule as the full plan. The
// numbers are the full plan's numbers; only the in-day reordering for opening hours is skipped (it is labelled a quick estimate).
import { STYLES, type StyleConfig, type StyleId } from "@/lib/trip-builder/config";
import { findClusters, type ClusterMap } from "@/lib/trip-builder/clusters";
import { costMatrix, dayLoads, returnNode } from "@/lib/trip-builder/loads";
import { makeCtx, type Ctx } from "@/lib/trip-builder/model";
import { partitionDays } from "@/lib/trip-builder/partition";
import { optimizeOpenPath } from "@/lib/trip-builder/tour";
import type { BuilderInput } from "@/lib/trip-builder/types";
import type { WhatIf } from "./types";

type Fit = { places: number; driveMin: number; km: number };

/** One ordering for the whole run; fits[days] = places kept and driving with that many days among the places. */
function fitter(ctx: Ctx, style: StyleConfig) {
  const clusters: ClusterMap = findClusters(ctx);
  const ret = returnNode(ctx);
  const n = ctx.places.length;
  const order0 = n ? optimizeOpenPath({ nodes: Array.from({ length: n }, (_, i) => i + 1), start: 0, end: ret, d: costMatrix(ctx) }) : [];
  return (core: number): (Fit & { last: number | null }) | null => {
    let order = order0;
    let days = partitionDays(ctx, order, core, clusters.clusterOf);
    while (!days) {
      const removable = order.filter((i) => ctx.priority(i) !== "must");
      if (!removable.length) break;
      // Same rule as the full plan: drop the stop whose loss costs the least value per minute saved.
      const scored = removable.map((x) => {
        const pos = order.indexOf(x), prev = pos === 0 ? 0 : order[pos - 1], next = pos + 1 < order.length ? order[pos + 1] : ret;
        const drive = Math.max(0, ctx.driveMin(prev, x) + (next !== null ? ctx.driveMin(x, next) - ctx.driveMin(prev, next) : 0));
        const total = drive + ctx.visitMin(x) + ctx.bufferMin;
        return { x, total, ratio: ctx.value(x) / Math.max(1, drive * style.driveWeight + (total - drive)) };
      });
      scored.sort((a, b) => a.ratio - b.ratio || ctx.value(a.x) - ctx.value(b.x) || b.total - a.total || a.x - b.x);
      order = order.filter((i) => i !== scored[0].x);
      days = partitionDays(ctx, order, core, clusters.clusterOf);
    }
    if (!days) return null;
    const loads = dayLoads(ctx, days);
    let km = 0, prev = 0;
    for (const i of days.flat()) { km += ctx.km(prev, i); prev = i; }
    if (ret !== null && prev !== 0) km += ctx.km(prev, ret);
    return { places: order.length, driveMin: loads.reduce((s, l) => s + l.drive, 0), km, last: order.length ? order[order.length - 1] : null };
  };
}

/**
 * For each total number of days (fromDays..toDays): how many places fit and the driving. `transitDays` (driving to and from a far-away
 * area) are part of every N. `homeDayCapMin`: on a round trip, also try ending the places a day earlier with a drive-home day of at most
 * this many minutes (the full plan does the same), and keep whichever fits more.
 */
export function whatIfDays(input: BuilderInput, styleId: StyleId, override: Partial<Omit<StyleConfig, "id">>, opts: { transitDays: number; transitDriveMin: number; transitKm: number; fromDays: number; toDays: number; homeDayCapMin?: number | null }): WhatIf[] {
  const style: StyleConfig = { ...STYLES[styleId], ...override, id: styleId };
  const n = input.places.length;
  const ctx = makeCtx(input, style);
  const fit = fitter(ctx, style);
  const homeCap = input.endMode === "start" ? opts.homeDayCapMin ?? null : null;
  const freeCtx = homeCap !== null ? makeCtx({ ...input, endMode: "free", end: null }, style) : null;
  const freeFit = freeCtx ? fitter(freeCtx, style) : null;
  const out: WhatIf[] = [];

  for (let N = opts.fromDays; N <= opts.toDays; N++) {
    const core = N - opts.transitDays;
    let best: Fit | null = core >= 1 ? fit(core) : null;
    if (freeFit && freeCtx && core >= 2) {
      const f = freeFit(core - 1);
      const home = f?.last ? freeCtx.driveMin(f.last, 0) : null;
      if (f && home !== null && home <= homeCap! && (!best || f.places > best.places)) best = { places: f.places, driveMin: f.driveMin + home, km: f.km + freeCtx.km(f.last!, 0) };
    }
    if (!best) { out.push({ days: N, places: 0, of: n, driveMin: core < 1 ? opts.transitDriveMin : 0, km: core < 1 ? opts.transitKm : 0, fits: false }); continue; }
    out.push({ days: N, places: best.places, of: n, fits: best.places === n, driveMin: Math.round(best.driveMin + opts.transitDriveMin), km: Math.round(best.km + opts.transitKm) });
  }
  return out;
}
