// "Will it fit?" — the honest arithmetic before any plan, and "what should I remove?" with the real minutes it saves.
import { PRIORITY_LABEL } from "./config";
import { costMatrix, returnNode } from "./loads";
import { duration, type Ctx } from "./model";
import { optimizeOpenPath, pathCost } from "./tour";
import type { Reality, RemoveSuggestion } from "./types";

function need(ctx: Ctx, nodes: number[]) {
  const cost = costMatrix(ctx);
  const ret = returnNode(ctx);
  const order = optimizeOpenPath({ nodes, start: 0, end: ret, d: cost });
  const path = [0, ...order, ...(ret !== null ? [ret] : [])];
  const driveMin = pathCost(path, cost);
  let km = 0;
  for (let i = 1; i < path.length; i++) km += ctx.km(path[i - 1], path[i]);
  const visitMin = order.reduce((s, i) => s + ctx.visitMin(i), 0);
  const bufferMin = order.length * ctx.bufferMin;
  return { order, driveMin, km, visitMin, bufferMin, neededMin: driveMin + visitMin + bufferMin };
}

export function realityFor(ctx: Ctx, numDays: number): Reality {
  const nodes = ctx.places.map((_, i) => i + 1);
  const r = need(ctx, nodes);
  const availableMin = numDays * ctx.style.capacityMin;
  const overMin = Math.round(r.neededMin - availableMin);
  const status: Reality["status"] = r.neededMin <= availableMin * 0.9 ? "fits" : r.neededMin <= availableMin ? "tight" : "over";
  const places = nodes.length;
  const headline =
    places === 0 ? "Add the places you want to see." :
    status === "over" ? `You have ${places} place${places === 1 ? "" : "s"} for ${numDays} day${numDays === 1 ? "" : "s"}, and that is about ${duration(overMin)} too much.` :
    status === "tight" ? `You have ${places} places for ${numDays} days: it fits, but it is tight.` :
    `You have ${places} place${places === 1 ? "" : "s"} for ${numDays} day${numDays === 1 ? "" : "s"}, and it fits comfortably.`;
  return {
    places, numDays, driveMin: Math.round(r.driveMin), driveKm: Math.round(r.km), visitMin: Math.round(r.visitMin), bufferMin: Math.round(r.bufferMin),
    mealMin: numDays * ctx.style.mealMin, neededMin: Math.round(r.neededMin), availableMin: Math.round(availableMin), overMin, status, headline,
  };
}

/** For each droppable place: what dropping it would really save (re-optimising the route without it), and whether the trip then fits. */
export function removeSuggestions(ctx: Ctx, numDays: number, max = 3): RemoveSuggestion[] {
  const all = ctx.places.map((_, i) => i + 1);
  const full = need(ctx, all);
  const available = numDays * ctx.style.capacityMin;
  const rows = all
    .filter((i) => ctx.priority(i) !== "must")
    .map((i) => {
      const without = need(ctx, all.filter((x) => x !== i));
      return { i, savedMin: full.neededMin - without.neededMin, savedDrive: full.driveMin - without.driveMin, fitsAfter: without.neededMin <= available, value: ctx.value(i) };
    })
    .filter((r) => r.savedMin > 5);
  rows.sort((a, b) => Number(b.fitsAfter) - Number(a.fitsAfter) || a.value / Math.max(1, a.savedMin) - b.value / Math.max(1, b.savedMin) || b.savedMin - a.savedMin || a.i - b.i);
  return rows.slice(0, max).map((r) => {
    const name = ctx.places[r.i - 1].name;
    return {
      placeId: ctx.places[r.i - 1].id, name, savedMin: Math.round(r.savedMin), savedDriveMin: Math.round(r.savedDrive), fitsAfter: r.fitsAfter,
      message: `Removing ${name} (${PRIORITY_LABEL[ctx.priority(r.i)]}) would save about ${duration(r.savedMin)} (${duration(r.savedDrive)} of it driving)${r.fitsAfter ? " and your trip would then fit." : "."}`,
    };
  });
}
