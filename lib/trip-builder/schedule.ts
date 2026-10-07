// Turning an ordered list of stops into a timed day: drive legs, opening hours, waiting, golden hour, buffers.
import { CATEGORIES } from "@/lib/categories";
import { GOLDEN_CATEGORIES, GOLDEN_WINDOW, MAX_PERMUTE } from "./config";
import type { Ctx } from "./model";
import type { PlannedStop, StopFlag } from "./types";

const parseHHMM = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

export type TimedDay = { stops: Omit<PlannedStop, "reasons" | "name" | "fromPrev">[]; startMin: number; endMin: number; driveMin: number; driveKm: number; visitMin: number; bufferMin: number; penalty: number };

/** Time one day. `prev` is the matrix node the day starts from (the trip start, or last night's place). */
export const MAX_GOLDEN_SHIFT_MIN = 180;

export function scheduleDay(ctx: Ctx, day: number, order: number[], prev: number, shift = 0): TimedDay {
  const s = ctx.style;
  let t = s.dayStartMin + shift, from = prev;
  let earlyBy = 0; // how much earlier than the golden hour the first golden stop is reached
  const stops: TimedDay["stops"] = [];
  let driveMin = 0, driveKm = 0, visitMin = 0, bufferMin = 0, penalty = 0;

  order.forEach((idx, k) => {
    const leg = Math.round(ctx.driveMin(from, idx));
    let arrive = t + leg;
    let wait = 0;
    const flags: StopFlag[] = [];
    const place = ctx.places[idx - 1];

    const o = ctx.open(idx, day, arrive);
    if (o.state === "closed") {
      const opensAt = o.at ? parseHHMM(o.at) : null;
      if (opensAt !== null && opensAt > arrive && opensAt < s.dayEndMin) { wait = opensAt - arrive; arrive = opensAt; flags.push("waited_for_opening"); penalty += wait * 0.5; }
      else { flags.push("closed_at_arrival"); penalty += 600; }
    } else if (o.state === "unknown") flags.push("hours_unknown");

    const visit = ctx.visitMin(idx);
    if (GOLDEN_CATEGORIES.includes(place.category)) {
      const sunset = ctx.sunsetMin(idx, day);
      if (sunset !== null) {
        const w0 = sunset - GOLDEN_WINDOW[0], w1 = sunset - GOLDEN_WINDOW[1];
        const ok = arrive >= w0 - 20 && arrive <= w1;
        flags.push(ok ? "golden_ok" : "golden_missed");
        if (!ok && arrive < w0 - 20 && earlyBy === 0) earlyBy = w0 - arrive;
        if (!ok) penalty += s.goldenWeight * Math.min(240, arrive < w0 ? w0 - arrive : arrive - w1) * 0.25;
      }
    }
    if (arrive > s.dayEndMin) { flags.push("late_arrival"); penalty += (arrive - s.dayEndMin) * 3; }
    const fit = ctx.fit(idx, day);
    if (fit !== null && fit < 45) flags.push("weather_poor");

    const depart = arrive + visit + ctx.bufferMin;
    stops.push({ placeId: place.id, day, order: k + 1, arriveMin: arrive, departMin: depart, driveMin: leg, driveKm: Math.round(ctx.km(from, idx) * 10) / 10, visitMin: visit, waitMin: wait, flags });
    driveMin += leg; driveKm += ctx.km(from, idx); visitMin += visit; bufferMin += ctx.bufferMin;
    t = depart; from = idx;
  });
  if (t > s.dayEndMin) penalty += (t - s.dayEndMin) * 2;
  // Too early for the golden hour but the day has room: start the day later instead of standing around (up to 3 h, never past the day's end).
  if (shift === 0 && earlyBy >= 15 && t < s.dayEndMin) {
    const slack = s.dayEndMin - t;
    const want = Math.min(earlyBy, MAX_GOLDEN_SHIFT_MIN, slack);
    if (want >= 15) return scheduleDay(ctx, day, order, prev, Math.round(want / 5) * 5);
  }
  return { stops, startMin: s.dayStartMin + shift, endMin: t, driveMin, driveKm, visitMin, bufferMin, penalty };
}

function* permutations<T>(a: T[]): Generator<T[]> {
  const n = a.length, c = new Array(n).fill(0), arr = [...a];
  yield [...arr];
  for (let i = 0; i < n; ) {
    if (c[i] < i) { const j = i % 2 === 0 ? 0 : c[i]; [arr[j], arr[i]] = [arr[i], arr[j]]; yield [...arr]; c[i]++; i = 0; }
    else { c[i] = 0; i++; }
  }
}

/**
 * Best order INSIDE one day when timing matters (opening hours, golden hour, finishing before dark): try every order for
 * small days. Returns the original order when nothing is better (so the road-optimal order wins ties).
 */
export function refineDayOrder(ctx: Ctx, day: number, order: number[], prev: number): number[] {
  if (order.length < 2 || order.length > MAX_PERMUTE) return order;
  const score = (o: number[]) => { const d = scheduleDay(ctx, day, o, prev); return d.driveMin + d.penalty; };
  let best = order, bestScore = score(order);
  for (const p of permutations(order)) {
    const sc = score(p);
    if (sc + 1e-6 < bestScore) { best = p; bestScore = sc; }
  }
  return best;
}

export const categoryLabel = (ctx: Ctx, idx: number) => CATEGORIES[ctx.places[idx - 1].category].label;
