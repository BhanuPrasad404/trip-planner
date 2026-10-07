// One plan for one travel style: order the places along the road, drop what cannot fit (never a must-do), split into days,
// make each day respect opening hours / golden hour / weather, then explain and check it.
import { PRIORITY_LABEL, STYLES, type StyleId } from "./config";
import { findClusters, type ClusterMap } from "./clusters";
import { assembleDays, planWarnings } from "./explain";
import { costMatrix, dayLoads, returnNode } from "./loads";
import { duration, makeCtx, type Ctx } from "./model";
import { partitionDays } from "./partition";
import { refineDayOrder } from "./schedule";
import { optimizeOpenPath } from "./tour";
import type { AddSuggestion, BuilderInput, DayPlan, PlanOption, RemovedStop } from "./types";

/** How much driving + visiting does removing `x` from the route save? (exactly what the traveller would get back) */
function savings(ctx: Ctx, order: number[], x: number) {
  const ret = returnNode(ctx);
  const pos = order.indexOf(x);
  const prev = pos === 0 ? 0 : order[pos - 1];
  const next = pos + 1 < order.length ? order[pos + 1] : ret;
  const drive = ctx.driveMin(prev, x) + (next !== null ? ctx.driveMin(x, next) - ctx.driveMin(prev, next) : 0);
  const visit = ctx.visitMin(x) + ctx.bufferMin;
  return { drive: Math.max(0, drive), total: Math.max(0, drive) + visit };
}

function weatherSwaps(ctx: Ctx, days: number[][]): number[][] {
  const hasFit = ctx.places.some((p) => (p.fit ?? []).some((x) => x !== null));
  if (!hasFit || days.length < 2) return days;
  let cur = days.map((d) => [...d]);
  const gain = (idx: number, from: number, to: number) => (ctx.fit(idx, to) ?? 60) - (ctx.fit(idx, from) ?? 60);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let a = 0; a < cur.length && !changed; a++) {
      for (let b = a + 1; b < cur.length && !changed; b++) {
        for (let i = 0; i < cur[a].length && !changed; i++) {
          for (let j = 0; j < cur[b].length && !changed; j++) {
            const x = cur[a][i], y = cur[b][j];
            const g = gain(x, a + 1, b + 1) + gain(y, b + 1, a + 1);
            if (g < 30) continue; // only swap for a clear weather win
            const next = cur.map((d) => [...d]);
            next[a][i] = y; next[b][j] = x;
            const before = dayLoads(ctx, cur), after = dayLoads(ctx, next);
            if (!after.every((l) => l.ok)) continue;
            const driveBefore = before.reduce((s, l) => s + l.drive, 0), driveAfter = after.reduce((s, l) => s + l.drive, 0);
            if (driveAfter - driveBefore > 25) continue; // never trade a lot of driving for weather
            cur = next; changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return cur;
}

function addBackSuggestions(ctx: Ctx, days: number[][], removed: RemovedStop[], idxById: Map<string, number>): AddSuggestion[] {
  const base = dayLoads(ctx, days);
  const out: AddSuggestion[] = [];
  for (const r of removed) {
    const x = idxById.get(r.placeId)!;
    let best: { day: number; extraDrive: number; spare: number; fits: boolean } | null = null;
    for (let d = 0; d < days.length; d++) {
      for (let p = 0; p <= days[d].length; p++) {
        const trial = days.map((a) => [...a]);
        trial[d].splice(p, 0, x);
        const loads = dayLoads(ctx, trial);
        const extraDrive = loads.reduce((s, l) => s + l.drive, 0) - base.reduce((s, l) => s + l.drive, 0);
        const fits = loads.every((l) => l.ok);
        const spare = ctx.style.capacityMin - loads[d].load;
        if (!best || (fits && !best.fits) || (fits === best.fits && (extraDrive < best.extraDrive - 1e-6 || (Math.abs(extraDrive - best.extraDrive) < 1e-6 && d + 1 < best.day)))) best = { day: d + 1, extraDrive, spare, fits };
      }
    }
    if (!best) continue;
    const extraTotal = best.extraDrive + ctx.visitMin(x) + ctx.bufferMin;
    out.push({
      placeId: r.placeId, name: r.name, day: best.day, extraDriveMin: Math.round(best.extraDrive), extraTotalMin: Math.round(extraTotal), spareAfterMin: Math.round(best.spare), fits: best.fits,
      message: best.fits
        ? `Add ${r.name}: about ${duration(best.extraDrive)} more driving and ${duration(ctx.visitMin(x) + ctx.bufferMin)} there. It fits on Day ${best.day} (${duration(best.spare)} spare afterwards).`
        : `${r.name} doesn't fit without dropping something: the best place for it is Day ${best.day}, which would be over its limit.`,
    });
  }
  return out;
}

export function buildPlan(input: BuilderInput, styleId: StyleId, shared?: { clusters?: ClusterMap }): PlanOption {
  const style = STYLES[styleId];
  const ctx = makeCtx(input, style);
  const clusters = shared?.clusters ?? findClusters(ctx);
  const cost = costMatrix(ctx);
  const ret = returnNode(ctx);
  const n = input.places.length;
  const idxById = new Map(input.places.map((p, i) => [p.id, i + 1]));
  const D = Math.max(1, Math.floor(input.numDays));

  let kept = Array.from({ length: n }, (_, i) => i + 1);
  const removed: RemovedStop[] = [];
  let order: number[] = [];
  let days: number[][] | null = null;

  for (;;) {
    order = optimizeOpenPath({ nodes: kept, start: 0, end: ret, d: cost });
    days = partitionDays(ctx, order, D, clusters.clusterOf);
    if (days) break;
    const removable = kept.filter((i) => ctx.priority(i) !== "must");
    if (removable.length === 0) break;
    // Drop the stop whose loss costs the least value per minute saved. Ties: lower priority first, then the bigger saving.
    const scored = removable.map((x) => { const s = savings(ctx, order, x); return { x, s, ratio: ctx.value(x) / Math.max(1, s.drive * style.driveWeight + (s.total - s.drive)) }; });
    scored.sort((a, b) => a.ratio - b.ratio || ctx.value(a.x) - ctx.value(b.x) || b.s.total - a.s.total || a.x - b.x);
    const pick = scored[0];
    removed.push({
      placeId: ctx.places[pick.x - 1].id, name: ctx.places[pick.x - 1].name, savedMin: Math.round(pick.s.total), savedDriveMin: Math.round(pick.s.drive),
      reason: `Dropped to fit ${D} day${D === 1 ? "" : "s"} at a ${style.label.toLowerCase()} pace: saves ${duration(pick.s.total)} (${duration(pick.s.drive)} of it driving) for a "${PRIORITY_LABEL[ctx.priority(pick.x)]}" place.`,
    });
    kept = kept.filter((i) => i !== pick.x);
  }

  const feasible = days !== null;
  if (!days) {
    // Even the must-dos alone do not fit. Say so; still produce the least-bad split (equal chunks) so the traveller can see it.
    const K = Math.min(D, Math.max(1, order.length));
    const size = Math.ceil(order.length / K);
    days = Array.from({ length: K }, (_, k) => order.slice(k * size, (k + 1) * size)).filter((d) => d.length);
  }

  // Inside each day: try every order for small days so opening hours / golden hour / finishing before dark are respected.
  let refined: number[][] = [];
  let prev = 0;
  days.forEach((d, k) => {
    const o = refineDayOrder(ctx, k + 1, d, prev);
    refined.push(o);
    if (o.length) prev = o[o.length - 1];
  });
  if (feasible && !dayLoads(ctx, refined).every((l) => l.ok)) refined = days; // refinement must never break a limit
  days = feasible ? weatherSwaps(ctx, refined) : refined;

  const dayPlans: DayPlan[] = assembleDays(ctx, days, clusters);
  const warnings = planWarnings(ctx, dayPlans, D);
  if (!feasible) {
    const over = dayPlans.reduce((s, d) => s + Math.max(0, d.loadMin - style.capacityMin), 0);
    warnings.unshift({ code: "over_capacity", severity: "risk", message: `Your must-do places alone need about ${duration(over)} more than ${D} day${D === 1 ? "" : "s"} allow at a ${style.label.toLowerCase()} pace. Add a day, or relax a must-do.` });
  }

  const canAddBack = removed.length ? addBackSuggestions(ctx, days, removed, idxById) : [];
  const stops = dayPlans.flatMap((d) => d.stops);
  const totals = {
    places: stops.length,
    km: Math.round(dayPlans.reduce((s, d) => s + d.driveKm, 0) * 10) / 10,
    driveMin: Math.round(dayPlans.reduce((s, d) => s + d.driveMin, 0)),
    visitMin: Math.round(dayPlans.reduce((s, d) => s + d.visitMin, 0)),
    nights: Math.max(0, dayPlans.filter((d) => d.stops.length > 0).length - 1),
    daysUsed: dayPlans.filter((d) => d.stops.length > 0).length,
  };
  return { style: styleId, label: style.label, tagline: style.tagline, feasible, days: dayPlans, kept: stops.map((s) => s.placeId), removed, totals, warnings, canAddBack };
}
