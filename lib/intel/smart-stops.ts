// Smart Stops: the stops a good co-driver would suggest — fuel before a long gap, food when it's meal time and a good place is
// coming up, a break after long driving, a bed if you'll arrive late, the sunset viewpoint you can still reach.
import type { PoiKind } from "@/lib/poi/types";
import { clockLabel, isRainy, localMinute, weatherAt, type RankContext } from "./ranking";
import type { RankedPoi, SmartStop, StopInput, Urgency } from "./types";

type Args = {
  ranked: RankedPoi[];
  ctx: RankContext;
  remainingKm: number;
  /** Driving minutes left on the route (without stays). */
  remainingDriveMin: number;
  stops: StopInput[];
  finishAtMs: number | null;
  sun: { sunsetMin: number } | null;
  dayEndMin: number;
  coverageComplete: boolean;
  mappedKm: number;
  /** Continuous driving so far, in minutes (null = unknown). */
  drivingMin: number | null;
};

const MEALS = [
  { id: "breakfast", label: "Breakfast", from: 7 * 60 + 30, to: 10 * 60, kinds: ["cafe", "food"] as PoiKind[] },
  { id: "lunch", label: "Lunch", from: 12 * 60, to: 14 * 60 + 30, kinds: ["food", "cafe"] as PoiKind[] },
  { id: "dinner", label: "Dinner", from: 19 * 60, to: 21 * 60 + 30, kinds: ["food"] as PoiKind[] },
];

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)} min`);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const byAlong = (a: RankedPoi, b: RankedPoi) => a.alongM - b.alongM;
const top = (xs: RankedPoi[], n: number) => [...xs].sort((a, b) => b.score - a.score).slice(0, n);

export function buildSmartStops(a: Args): SmartStop[] {
  const { ranked, ctx } = a;
  // Claims about gaps ("no fuel for X km") only make sense inside the part of the road we have actually mapped.
  const remainingKm = Math.min(a.remainingKm, a.mappedKm);
  const out: SmartStop[] = [];
  const of = (...kinds: PoiKind[]) => ranked.filter((r) => kinds.includes(r.kind));
  const range = ctx.prefs.vehicleRangeKm;
  const nowLocal = localMinute(ctx.nowMs, ctx.utcOffsetMin);

  // ── Fuel: no guessing about the tank — we look for GAPS on the road ahead relative to the vehicle's range. ──
  const fuel = of("fuel").sort(byAlong);
  const next = fuel[0];
  if (next) {
    const after = fuel[1];
    const gapAfter = (after ? after.aheadKm : remainingKm) - next.aheadKm;
    const risky = gapAfter > range * 0.55;
    const nearby = next.aheadKm <= 25;
    if (risky || next.aheadKm > range * 0.45) {
      const urgency: Urgency = risky && nearby ? "now" : "soon";
      const options = top(fuel.filter((f) => f.aheadKm <= Math.max(next.aheadKm + 25, 30)), 3);
      out.push({
        id: "fuel",
        type: "fuel",
        title: urgency === "now" ? "Fill up at the next station" : "Plan a fuel stop",
        reason: risky
          ? `Next fuel is ${Math.round(next.aheadKm)} km ahead, and after that there is a ${Math.round(gapAfter)} km stretch with no station on your route (your range: ${range} km).`
          : `The next station is ${Math.round(next.aheadKm)} km away — a long way for a ${range} km range.`,
        urgency,
        options,
      });
    }
  } else if (a.coverageComplete && remainingKm > range * 0.35) {
    out.push({
      id: "fuel",
      type: "fuel",
      title: "No fuel found on your route ahead",
      reason: `We found no fuel station in the next ${Math.round(remainingKm)} km of your route. Fill up before you go further if you can.`,
      urgency: "now",
      options: [],
    });
  }

  // ── Meals: only when a window is open or opening soon AND a good place is reachable inside it. ──
  for (const m of MEALS) {
    if (nowLocal > m.to || nowLocal < m.from - 90) continue;
    const options = of(...m.kinds).filter((r) => {
      const arrive = localMinute(ctx.nowMs + r.etaMin * 60_000, ctx.utcOffsetMin);
      return arrive >= m.from && arrive <= m.to;
    });
    if (options.length === 0) continue;
    const best = top(options, 3);
    const open = nowLocal >= m.from;
    out.push({
      id: `meal-${m.id}`,
      type: "meal",
      title: `${m.label} ahead`,
      reason: `${options.length} ${options.length === 1 ? "place" : "places"} you can reach between ${hm(m.from)} and ${hm(m.to)}. The best is ${best[0].aheadKm < 1 ? "just ahead" : `${Math.round(best[0].aheadKm)} km ahead`}.`,
      urgency: open && best[0].etaMin <= 20 ? "now" : nowLocal >= m.from - 60 ? "soon" : "later",
      options: best,
    });
    break; // one meal suggestion at a time
  }

  // ── Break: based on how long you have REALLY been driving; otherwise on the driving still planned. ──
  const drivenMin = a.drivingMin ?? 0;
  if (drivenMin >= 90) {
    const spots = of("restroom", "cafe", "food", "fuel").filter((r) => r.etaMin <= 45 && r.detourMin <= 8);
    if (spots.length > 0) {
      const best = top(spots, 1)[0];
      out.push({
        id: "break",
        type: "break",
        title: drivenMin >= 150 ? "Time for a proper break" : "A break would help",
        reason: `You've been driving for ${dur(drivenMin)}. ${best.name} is ${best.etaMin} min ahead${best.detourMin > 0 ? ` with a ${best.detourMin} min detour` : ", right on your road"}.`,
        urgency: drivenMin >= 150 ? "now" : drivenMin >= 120 ? "soon" : "later",
        options: top(spots, 3),
      });
    }
  } else if (a.remainingDriveMin > 130) {
    const window = of("restroom", "cafe", "fuel").filter((r) => r.etaMin >= 90 && r.etaMin <= 130);
    if (window.length > 0) {
      out.push({
        id: "break",
        type: "break",
        title: "Stretch break coming up",
        reason: `Around ${window[0].etaMin >= 100 ? "two hours" : "1½ hours"} of driving from now — ${window.length} good places to stop.`,
        urgency: "later",
        options: top(window, 3),
      });
    }
  }

  // ── Stay: arriving late means you want a bed lined up near the end of the route. ──
  if (a.finishAtMs !== null) {
    const finish = localMinute(a.finishAtMs, ctx.utcOffsetMin);
    if (finish >= Math.max(21 * 60, a.dayEndMin + 60)) {
      const totalM = ctx.route.totalM;
      const stays = of("stay").filter((s) => s.alongM >= totalM - 25_000);
      if (stays.length > 0) {
        out.push({
          id: "stay",
          type: "stay",
          title: `You'll arrive around ${clockLabel(a.finishAtMs, ctx.utcOffsetMin)} — line up a stay`,
          reason: `${stays.length} ${stays.length === 1 ? "place" : "places"} to sleep near the end of today's route.`,
          urgency: finish >= 22 * 60 ? "soon" : "later",
          options: top(stays, 3),
        });
      }
    }
  }

  // ── Sunset: a viewpoint you can still reach in good light. ──
  if (a.sun && a.sun.sunsetMin > nowLocal && a.sun.sunsetMin - nowLocal <= 240) {
    const view = of("viewpoint").filter((v) => {
      const arrive = localMinute(ctx.nowMs + v.etaMin * 60_000, ctx.utcOffsetMin);
      const w = weatherAt(ctx.weather, v, ctx.nowMs + v.etaMin * 60_000);
      return arrive >= a.sun!.sunsetMin - 100 && arrive <= a.sun!.sunsetMin - 10 && v.detourMin <= 15 && !isRainy(w);
    });
    if (view.length > 0) {
      out.push({
        id: "sunset",
        type: "sunset",
        title: `Catch the sunset at ${hm(a.sun.sunsetMin)}`,
        reason: `${view[0].name} is reachable before sunset${view[0].detourMin > 0 ? `, with a ${view[0].detourMin} min detour` : ", right on your way"}.`,
        urgency: a.sun.sunsetMin - nowLocal <= 120 ? "soon" : "later",
        options: top(view, 2),
      });
    }
  }

  // ── Better opportunity: a strong sight/viewpoint close to the road that fits the day, ideally with a reason to go NOW. ──
  const plannedNames = new Set(a.stops.map((s) => s.name.toLowerCase()));
  const slackMin = a.finishAtMs !== null ? a.dayEndMin - localMinute(a.finishAtMs, ctx.utcOffsetMin) : 0;
  if (slackMin >= 60) {
    const worth = of("sight", "viewpoint").filter((r) => r.score >= 55 && r.detourMin <= 12 && r.aheadKm <= 40 && !plannedNames.has(r.name.toLowerCase()) && (r.kind === "sight" || !out.some((o) => o.type === "sunset")) && slackMin >= r.detourMin + 45);
    if (worth.length > 0) {
      const best = top(worth, 1)[0];
      const arriveMs = ctx.nowMs + best.etaMin * 60_000;
      const w = weatherAt(ctx.weather, best, arriveMs);
      const facts: string[] = [];
      if (w && !isRainy(w) && (w.precipProb ?? 0) < 30) facts.push("clear weather");
      const untilSunset = a.sun ? a.sun.sunsetMin - localMinute(arriveMs, ctx.utcOffsetMin) : null;
      if (untilSunset !== null && untilSunset > 5 && untilSunset <= 100) facts.push(`sunset starts ${untilSunset} min after you arrive`);
      if (best.reasons.some((r) => /Fresh updates/.test(r))) facts.push("recent traveler updates");
      const timely = facts.length > 0;
      out.push({
        id: "detour",
        type: "detour",
        title: timely ? "Better opportunity found" : "Worth a short detour",
        reason: `${best.name} is ${best.etaMin} min ahead${timely ? ` with ${facts.join(" and ")}` : ""}. It adds ${best.detourMin > 0 ? `a ${best.detourMin}-minute detour` : "no detour"} and fits your schedule (about ${dur(slackMin)} of slack today).`,
        urgency: timely ? "soon" : "later",
        options: top(worth, 3),
      });
    }
  }
  return out;
}

