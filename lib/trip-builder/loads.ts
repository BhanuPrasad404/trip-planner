// How loaded is each day? One definition used by the partitioner, the swaps and the add-back checks.
import { LONG_TRANSFER_FACTOR } from "./config";
import type { Ctx } from "./model";

/** Square matrix of road minutes WITH the drive buffer, over all matrix nodes (what the optimiser minimises). */
export function costMatrix(ctx: Ctx): number[][] {
  const size = ctx.places.length + 1 + (ctx.endIdx !== null ? 1 : 0);
  return Array.from({ length: size }, (_, a) => Array.from({ length: size }, (_, b) => (a === b ? 0 : ctx.driveMin(a, b))));
}

/** Where the return leg goes (start, a chosen end point, or nowhere). */
export const returnNode = (ctx: Ctx): number | null => (ctx.input.endMode === "start" ? 0 : ctx.endIdx);

export type DayLoad = { drive: number; visit: number; buffer: number; load: number; ok: boolean; longTransfer: boolean };

export function dayFits(ctx: Ctx, drive: number, load: number, single: boolean): { ok: boolean; longTransfer: boolean } {
  const s = ctx.style;
  if (drive <= s.maxDriveMin && load <= s.capacityMin) return { ok: true, longTransfer: false };
  // A single far stop cannot be split by an overnight stop in the middle of nowhere: allow a bounded long transfer day.
  if (single && drive <= s.maxDriveMin * LONG_TRANSFER_FACTOR && load <= s.capacityMin * 1.3) return { ok: true, longTransfer: true };
  return { ok: false, longTransfer: false };
}

/** Loads for consecutive days. Each day starts where the previous night was spent; the last day adds the return leg. */
export function dayLoads(ctx: Ctx, days: number[][]): DayLoad[] {
  const ret = returnNode(ctx);
  let prev = 0;
  return days.map((stops, d) => {
    let drive = 0, visit = 0;
    for (const idx of stops) { drive += ctx.driveMin(prev, idx); visit += ctx.visitMin(idx); prev = idx; }
    if (d === days.length - 1 && ret !== null && stops.length) drive += ctx.driveMin(prev, ret);
    const buffer = stops.length * ctx.bufferMin;
    const load = drive + visit + buffer;
    const f = dayFits(ctx, drive, load, stops.length === 1);
    return { drive, visit, buffer, load, ok: f.ok, longTransfer: f.longTransfer };
  });
}
