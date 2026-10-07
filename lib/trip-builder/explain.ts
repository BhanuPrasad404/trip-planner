// Turns a finished plan into what the traveller reads: timed days, "why this order", and warnings.
// Every sentence is assembled from the numbers the optimiser used — nothing is written by an AI after the fact.
import { PRIORITY_LABEL } from "./config";
import { INTENSITY } from "./config";
import { dayLoads, returnNode } from "./loads";
import { duration, hhmm, type Ctx } from "./model";
import { scheduleDay } from "./schedule";
import type { DayPlan, Intensity, PlannedStop, Warning } from "./types";
import type { ClusterMap } from "./clusters";

export function intensityOf(ctx: Ctx, drive: number, load: number): Intensity {
  const share = load / ctx.style.capacityMin;
  if (share > INTENSITY.heavy + 1e-9) return "overloaded";
  if (share > INTENSITY.moderate || drive > ctx.style.maxDriveMin * 0.85) return "heavy";
  if (share > INTENSITY.comfortable) return "moderate";
  return "comfortable";
}

function dateOf(ctx: Ctx, day: number): string | null {
  const ms = ctx.utcAt(day, 720);
  return ms === null ? null : new Date(ms + ctx.input.utcOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** Timed days with names, directions and reasons. `days` = matrix nodes per day in final order. */
export function assembleDays(ctx: Ctx, days: number[][], clusters: ClusterMap): DayPlan[] {
  const ret = returnNode(ctx);
  const loads = dayLoads(ctx, days);
  const flat = days.flat();
  const out: DayPlan[] = [];
  let prev = 0;

  days.forEach((order, d) => {
    const day = d + 1;
    const timed = scheduleDay(ctx, day, order, prev);
    const isLast = d === days.length - 1;
    let returnLeg: DayPlan["returnLeg"] = null;
    let drive = timed.driveMin, km = timed.driveKm, endMin = timed.endMin;
    if (isLast && ret !== null && order.length) {
      const last = order[order.length - 1];
      returnLeg = { to: ctx.point(ret).name, driveMin: Math.round(ctx.driveMin(last, ret)), km: Math.round(ctx.km(last, ret) * 10) / 10 };
      drive += returnLeg.driveMin; km += returnLeg.km; endMin += returnLeg.driveMin;
    }
    const load = drive + timed.visitMin + timed.bufferMin;

    let before = prev;
    const stops: PlannedStop[] = timed.stops.map((t, k) => {
      const idx = order[k];
      const prevName = ctx.point(before).name;
      const nextIdx = k + 1 < order.length ? order[k + 1] : null;
      const reasons: string[] = [];
      reasons.push(`${t.driveMin} min / ${t.driveKm} km by road ${k === 0 && d > 0 ? `from last night's stop, ${prevName}` : `from ${prevName}`} (${ctx.dir(before, idx)})`);

      // closest of the places still to come?
      const ahead = flat.slice(flat.indexOf(idx));
      const nearest = ahead.reduce((b, x) => (ctx.dur(before, x) < ctx.dur(before, b) - 1e-9 ? x : b), ahead[0]);
      if (nearest === idx && ahead.length > 1) reasons.push(`Closest of your remaining places to ${prevName}`);

      const cl = clusters.clusterOf.get(idx);
      if (cl && cl === clusters.clusterOf.get(before) && before !== 0) reasons.push(`Same area as ${prevName}: visited together`);

      if (nextIdx !== null) {
        const extra = Math.round(ctx.driveMin(before, idx) + ctx.driveMin(idx, nextIdx) - ctx.driveMin(before, nextIdx));
        if (extra > 5) reasons.push(`Adds about ${extra} min compared with driving straight on to ${ctx.point(nextIdx).name}`);
      }

      if (t.flags.includes("waited_for_opening")) reasons.push(`Opens later than your arrival: you wait ${duration(t.waitMin)} (it opens at ${hhmm(t.arriveMin)})`);
      if (t.flags.includes("closed_at_arrival")) reasons.push(`Known opening hours say it is CLOSED when you arrive (${hhmm(t.arriveMin)})`);
      else if (!t.flags.includes("hours_unknown") && !t.flags.includes("waited_for_opening")) reasons.push(`Open when you arrive (${hhmm(t.arriveMin)})`);
      if (t.flags.includes("golden_ok") || t.flags.includes("golden_missed")) {
        const sunset = ctx.sunsetMin(idx, day);
        if (sunset !== null) reasons.push(t.flags.includes("golden_ok") ? `You arrive ${hhmm(t.arriveMin)}, ${duration(sunset - t.arriveMin)} before sunset (${hhmm(sunset)}): golden-hour light` : `Sunset is ${hhmm(sunset)}; you arrive ${hhmm(t.arriveMin)}, outside the golden hour`);
      }
      const fit = ctx.fit(idx, day);
      if (fit !== null) {
        const note = ctx.places[idx - 1].fitNote?.[day - 1];
        const all = ctx.places[idx - 1].fit ?? [];
        const best = Math.max(...all.filter((x): x is number => x !== null));
        reasons.push(`Weather fit ${fit}/100 on Day ${day}${note ? ` (${note})` : ""}${fit >= best && all.filter((x) => x !== null).length > 1 ? " — the best day of your trip for this place" : ""}`);
      }
      if (t.flags.includes("golden_ok") && timed.startMin > ctx.style.dayStartMin) reasons.push(`The day starts at ${hhmm(timed.startMin)} (not ${hhmm(ctx.style.dayStartMin)}) so you reach this in the golden hour`);
      if (ctx.priority(idx) === "must") reasons.push("Marked must-do: kept no matter what");
      else if (ctx.priority(idx) !== "normal") reasons.push(`Priority: ${PRIORITY_LABEL[ctx.priority(idx)]}`);

      const stop: PlannedStop = { ...t, name: ctx.places[idx - 1].name, reasons, fromPrev: { dir: ctx.dir(before, idx), km: t.driveKm, fromName: prevName } };
      before = idx;
      return stop;
    });

    // why does the day end here?
    let whyEnds: string | null = null;
    const nextStop = days[d + 1]?.[0];
    if (nextStop !== undefined && order.length) {
      const last = order[order.length - 1];
      const add = ctx.driveMin(last, nextStop) + ctx.visitMin(nextStop) + ctx.bufferMin;
      const reasonsToStop = load + add > ctx.style.capacityMin
        ? `adding ${ctx.point(nextStop).name} (${duration(ctx.driveMin(last, nextStop))} driving + ${duration(ctx.visitMin(nextStop) + ctx.bufferMin)} there) would make the day ${duration(load + add)}, over the ${duration(ctx.style.capacityMin)} limit`
        : `the next stretch would put you on the road after ${hhmm(ctx.style.dayEndMin)} or leave the days uneven`;
      whyEnds = `Day ${day} ends here because ${reasonsToStop}.`;
    }

    out.push({
      day, date: dateOf(ctx, day), stops, driveMin: drive, driveKm: Math.round(km * 10) / 10, visitMin: timed.visitMin, bufferMin: timed.bufferMin, loadMin: load,
      capacityMin: ctx.style.capacityMin, intensity: intensityOf(ctx, drive, load), startMin: timed.startMin, endMin,
      overnightNear: nextStop !== undefined && order.length ? ctx.point(order[order.length - 1]).name : null, whyEnds, returnLeg, longTransfer: loads[d].longTransfer,
    });
    if (order.length) prev = order[order.length - 1];
  });
  return out;
}

// ── Warnings ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function planWarnings(ctx: Ctx, days: DayPlan[], numDays: number): Warning[] {
  const w: Warning[] = [];
  const s = ctx.style;
  for (const d of days) {
    if (d.loadMin > s.capacityMin + 1e-9 && !d.longTransfer) w.push({ code: "over_capacity", severity: "risk", day: d.day, message: `Day ${d.day} is ${duration(d.loadMin)} of driving and sightseeing — over the ${duration(s.capacityMin)} a ${s.label.toLowerCase()} day can hold.` });
    else if (d.driveMin > s.maxDriveMin * 0.8) w.push({ code: "too_much_driving", severity: "warn", day: d.day, message: `Day ${d.day} has ${duration(d.driveMin)} of driving (${Math.round(d.driveKm)} km).` });
    else if (d.stops.length > 0 && s.capacityMin - d.loadMin < 30) w.push({ code: "tight_day", severity: "info", day: d.day, message: `Day ${d.day} is tight: only ${duration(Math.max(0, s.capacityMin - d.loadMin))} spare for delays.` });
    if (d.driveMin > 180 && d.driveMin / Math.max(1, d.loadMin) > 0.65) w.push({ code: "mostly_driving", severity: "info", day: d.day, message: `Day ${d.day} is mostly in the car: ${duration(d.driveMin)} driving for ${duration(d.visitMin)} at places.` });
    if (d.longTransfer) w.push({ code: "long_transfer", severity: "warn", day: d.day, message: `Day ${d.day} is mainly one long transfer (${duration(d.driveMin)}). There is no better place to break it in your list.` });
    for (const st of d.stops) {
      if (st.flags.includes("closed_at_arrival")) w.push({ code: "closed_at_arrival", severity: "risk", day: d.day, placeId: st.placeId, message: `${st.name} is closed at ${hhmm(st.arriveMin)} (its listed opening hours).` });
      if (st.flags.includes("late_arrival")) w.push({ code: "late_arrival", severity: "warn", day: d.day, placeId: st.placeId, message: `You would reach ${st.name} at ${hhmm(st.arriveMin)}, after the planned day end (${hhmm(s.dayEndMin)}).` });
      if (st.flags.includes("weather_poor")) { const fit = ctx.fit(ctx.places.findIndex((p) => p.id === st.placeId) + 1, d.day); w.push({ code: "weather_poor", severity: "warn", day: d.day, placeId: st.placeId, message: `Weather looks poor for ${st.name} on Day ${d.day}${fit !== null ? ` (fit ${fit}/100)` : ""}.` }); }
    }
  }
  const unknown = days.flatMap((d) => d.stops).filter((st) => st.flags.includes("hours_unknown")).length;
  if (unknown > 0) w.push({ code: "hours_unknown", severity: "info", message: `Opening hours aren't known for ${unknown} place${unknown === 1 ? "" : "s"}, so we can't check them. Treat times there as unconfirmed.` });

  for (let i = 1; i < days.length; i++) {
    const heavy = (x: DayPlan) => x.intensity === "heavy" || x.intensity === "overloaded";
    if (heavy(days[i]) && heavy(days[i - 1])) w.push({ code: "heavy_streak", severity: "warn", day: days[i].day, message: `Days ${days[i - 1].day} and ${days[i].day} are both heavy. Tiredness builds up.` });
  }

  const bt = backtracking(ctx, days);
  if (bt) w.push({ code: "backtracking", severity: "warn", message: bt });
  if (ctx.input.matrix.source === "estimate") w.push({ code: "estimated_times", severity: "warn", message: "Driving times are estimates: the routing service was unavailable. Real roads may be slower." });
  else if ((ctx.input.matrix.estimatedPairs ?? 0) > 0) w.push({ code: "estimated_times", severity: "warn", message: `No road connection was found between ${ctx.input.matrix.estimatedPairs} pair${ctx.input.matrix.estimatedPairs === 1 ? "" : "s"} of your places (an island, a missing or closed road?). Those distances are straight-line estimates.` });
  const used = days.filter((d) => d.stops.length > 0).length;
  if (used < numDays) w.push({ code: "empty_days", severity: "info", message: `${numDays - used} of your ${numDays} days have nothing planned. Add places, or choose Relaxed for more time at each stop.` });
  return w;
}

/** Does the route double back? Projects stops onto the start→farthest-stop axis and adds up the distance travelled "backwards". */
function backtracking(ctx: Ctx, days: DayPlan[]): string | null {
  if (ctx.input.endMode === "start") return null; // a round trip comes back by design
  const order = days.flatMap((d) => d.stops.map((s) => ctx.places.findIndex((p) => p.id === s.placeId) + 1));
  if (order.length < 3) return null;
  const far = order.reduce((b, x) => (ctx.km(0, x) > ctx.km(0, b) ? x : b), order[0]);
  const span = ctx.km(0, far);
  if (span < 20) return null;
  const o = ctx.point(0), f = ctx.point(far);
  const ax = (f.lng - o.lng) * Math.cos((o.lat * Math.PI) / 180), ay = f.lat - o.lat;
  const norm = Math.hypot(ax, ay) || 1;
  const proj = (i: number) => { const p = ctx.point(i); return (((p.lng - o.lng) * Math.cos((o.lat * Math.PI) / 180)) * ax + (p.lat - o.lat) * ay) / norm / norm * span; };
  let back = 0, prev = 0;
  for (const i of order) { const p = proj(i); back += Math.max(0, proj(prev) - p); prev = i; }
  return back > 40 && back > 0.25 * span ? `The route doubles back by about ${Math.round(back)} km in total. Another order (or fewer places) may avoid it.` : null;
}
