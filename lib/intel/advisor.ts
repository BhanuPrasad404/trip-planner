// "What should I do next?" — turns the situation into a short, prioritised list of advice, each with an optional one-tap action.
// It never changes anything itself: replan / skip are suggestions the traveller confirms.
import { clockLabel, isRainy, localMinute, weatherAt } from "./ranking";
import type { Advice, RankedPoi, SmartStop, StopEta, StopInput, WeatherSample } from "./types";

type Args = {
  smartStops: SmartStop[];
  stops: StopInput[];
  stopEtas: StopEta[];
  /** Driving minutes of the leg INTO each stop (same order as `stops`). */
  legMinutes: number[];
  finishAtMs: number | null;
  dayEndMin: number;
  nowMs: number;
  utcOffsetMin: number;
  weather: WeatherSample[];
  sunsetMin: number | null;
  comparePlan: boolean;
  canMoveNextDay: boolean;
};

const URGENCY_PRIORITY = { fuel: { now: 95, soon: 72, later: 50 }, meal: { now: 76, soon: 62, later: 42 } } as const;
const BASE_PRIORITY: Record<SmartStop["type"], Record<SmartStop["urgency"], number>> = {
  fuel: URGENCY_PRIORITY.fuel,
  meal: URGENCY_PRIORITY.meal,
  break: { now: 60, soon: 50, later: 44 },
  stay: { now: 74, soon: 68, later: 52 },
  sunset: { now: 66, soon: 58, later: 46 },
  detour: { now: 40, soon: 36, later: 34 },
};

export function buildAdvice(a: Args): Advice[] {
  const out: Advice[] = [];

  for (const s of a.smartStops) {
    out.push({
      id: s.id,
      kind: s.type,
      priority: BASE_PRIORITY[s.type][s.urgency],
      urgency: s.urgency,
      title: s.title,
      detail: s.reason,
      options: s.options,
      action: s.options[0] ? (s.type === "detour" ? { type: "insert_stop", key: s.options[0].key } : { type: "poi", key: s.options[0].key }) : undefined,
      why: whyOf(s),
    });
  }

  // Behind the plan.
  const first = a.stopEtas[0];
  if (a.comparePlan && first && first.delayMin !== null && first.delayMin >= 20) {
    out.push({
      id: "behind",
      kind: "behind",
      priority: 80,
      urgency: "now",
      title: `You're about ${first.delayMin} min behind plan`,
      detail: `You'll reach ${first.name} around ${first.etaClock}. Re-plan to fit the rest of the day around where you are now.`,
      action: { type: "replan" },
      why: [`Estimated arrival at ${first.name}: ${first.etaClock}`, `Planned: ${a.stops[0]?.plannedArrival ?? "—"}`, `Difference: ${first.delayMin} min`],
    });
  }

  // Not going to finish in time → say so, and offer the cheapest stops to drop.
  if (a.finishAtMs !== null && a.stops.length > 0) {
    const finish = localMinute(a.finishAtMs, a.utcOffsetMin);
    const over = finish - a.dayEndMin;
    if (over > 15) {
      out.push({
        id: "late",
        kind: "late",
        priority: 90,
        urgency: "now",
        title: `At this pace you'll finish around ${clockLabel(a.finishAtMs, a.utcOffsetMin)}`,
        detail: `That is about ${over} min after your ${String(Math.floor(a.dayEndMin / 60)).padStart(2, "0")}:${String(a.dayEndMin % 60).padStart(2, "0")} target.`,
        action: { type: "replan" },
        why: [
          `Expected finish ${clockLabel(a.finishAtMs, a.utcOffsetMin)} vs target ${String(Math.floor(a.dayEndMin / 60)).padStart(2, "0")}:${String(a.dayEndMin % 60).padStart(2, "0")}`,
          `${a.stops.length} stop${a.stops.length === 1 ? "" : "s"} left: ${Math.round(a.legMinutes.reduce((x, y) => x + y, 0))} min driving + ${a.stops.reduce((x, s) => x + s.visitMin, 0)} min at the stops`,
        ],
      });

      // Drop the stops that give the least for the time they cost (never the one you're about to reach).
      const candidates = a.stops
        .map((s, i) => ({ s, saving: s.visitMin + (a.legMinutes[i] ?? 0) * 0.5, etaMin: (a.stopEtas[i]?.alongKm ?? 0) }))
        .filter((c, i) => i > 0 || (a.legMinutes[0] ?? 99) > 10)
        .sort((x, y) => (x.s.value + 0.25) / x.saving - (y.s.value + 0.25) / y.saving);
      let covered = 0;
      for (const c of candidates.slice(0, 3)) {
        if (covered >= over) break;
        covered += c.saving;
        const move = a.canMoveNextDay;
        out.push({
          id: `${move ? "move" : "skip"}-${c.s.id}`,
          kind: "skip",
          priority: 88 - out.filter((o) => o.kind === "skip").length * 2,
          urgency: "now",
          title: move ? `Move ${c.s.name} to tomorrow?` : `Skip ${c.s.name}?`,
          detail: `Saves about ${Math.round(c.saving)} min today.${c.s.valueNote ? ` ${c.s.valueNote}` : " It scores lowest for the time it costs."}${move ? " Nothing is deleted — it just moves to the next day." : ""}`,
          action: move ? { type: "move_next_day", stopId: c.s.id } : { type: "skip", stopId: c.s.id },
          why: [`Costs about ${Math.round(c.saving)} min (${c.s.visitMin} min there + part of the drive)`, `Value for the time: ${(c.s.value).toFixed(1)} of 2${c.s.valueNote ? ` (${c.s.valueNote.replace(/\.$/, "")})` : ""}`, `You are ${over} min over your target`],
        });
      }
    }
  }

  // Weather and daylight at each outdoor stop, at the time you'll actually be there.
  const dryOutdoor: string[] = [];
  const wet: { s: StopInput; clock: string; prob: number | null }[] = [];
  a.stops.forEach((s, i) => {
    if (!s.outdoor) return;
    const eta = a.stopEtas[i];
    if (!eta) return;
    const etaMs = a.nowMs + etaMinutesFrom(a, i) * 60_000;
    const w = weatherAt(a.weather, s, etaMs);
    if (isRainy(w)) wet.push({ s, clock: eta.etaClock, prob: w?.precipProb ?? null });
    else if (w) dryOutdoor.push(s.name);
    if (w && w.tempC >= 38) {
      out.push({ id: `heat-${s.id}`, kind: "weather", priority: 70, urgency: "soon", title: `Very hot at ${s.name} (${Math.round(w.tempC)}°C)`, detail: `You'll be there around ${eta.etaClock}. Carry water and keep outdoor time short, or go earlier.` });
    }
    if (a.sunsetMin !== null) {
      const arrive = localMinute(etaMs, a.utcOffsetMin);
      if (arrive >= a.sunsetMin - 20 && arrive < a.sunsetMin + 240) {
        out.push({ id: `dark-${s.id}`, kind: "daylight", priority: 78, urgency: "soon", title: `${s.name} may be in the dark`, detail: `You'll arrive around ${eta.etaClock}; sunset is ${String(Math.floor(a.sunsetMin / 60)).padStart(2, "0")}:${String(a.sunsetMin % 60).padStart(2, "0")}. Outdoor places can be unsafe or closed after dark.` });
      }
    }
  });
  for (const w of wet) {
    out.push({
      id: `rain-${w.s.id}`,
      kind: "weather",
      priority: 85,
      urgency: "soon",
      title: `Rain likely at ${w.s.name} around ${w.clock}${w.prob !== null ? ` (${Math.round(w.prob)}%)` : ""}`,
      detail: dryOutdoor.length > 0 ? `${dryOutdoor[0]} looks dry at its time — consider doing that first, or keep rain gear handy.` : "Keep rain gear handy; trails and viewpoints can be slippery or foggy.",
      why: [`Forecast at ${w.s.name} for ${w.clock}${w.prob !== null ? `: ${Math.round(w.prob)}% chance of rain` : ""}`, "Outdoor stop (viewpoints, trails and forts are affected by rain)"],
    });
  }

  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id)).sort((x, y) => y.priority - x.priority);
}

function whyOf(s: SmartStop): string[] {
  const o = s.options[0];
  const facts = [s.reason];
  if (o) facts.push(`${o.name}: ${o.aheadKm < 1 ? "just ahead" : `${Math.round(o.aheadKm)} km ahead`}, ${o.detourMin > 0 ? `${o.detourMin} min detour` : "on your road"}, arrive about ${o.arriveClock}`);
  if (o?.open.state === "open") facts.push(`Open when you arrive${o.open.at ? ` (until ${o.open.at})` : ""}`);
  else if (o?.open.state === "unknown") facts.push("Opening hours are not listed on the map, so call ahead if it matters");
  return facts;
}

/** Minutes from now until we ARRIVE at stop i (driving legs + stays at earlier stops). */
function etaMinutesFrom(a: Args, i: number): number {
  let t = 0;
  for (let k = 0; k <= i; k++) {
    t += a.legMinutes[k] ?? 0;
    if (k < i) t += a.stops[k].visitMin;
  }
  return t;
}

export type { RankedPoi };
