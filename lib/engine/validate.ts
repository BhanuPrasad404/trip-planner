// An INDEPENDENT check of a finished plan against the raw input (the handoff's acceptance rules). It does not reuse the scheduler: it
// recomputes from the road table, the stated margin, sunset and the plan's own times, and lists every broken rule. The planner may
// break a rule only when it says so (a warning on that day); breaking one silently is a violation.
//
// Used in tests (every fixture plan must pass) and on the server as a LOG check only: it never blocks or changes a plan.
import { STYLES, LONG_TRANSFER_FACTOR } from "@/lib/trip-builder/config";
import { styleFor, VARIANT_STYLE } from "./core";
import { sunsetAt } from "./daylight";
import { withMargin } from "./margin";
import { transitCap } from "./plan";
import { HALT_RESERVE_MIN } from "./transit";
import type { EngineInput, EnginePlan, VariantId } from "./types";

export type ViolationRule = "places" | "must_dropped" | "timeline" | "road_time" | "driving" | "transit_driving" | "daylight" | "closed" | "overnight";
export type Violation = { rule: ViolationRule; variant: VariantId; day?: number; message: string };

/** Minutes of slack for rounding (the plan rounds to whole minutes, sometimes to 5). */
const SLACK = 2;

export function validatePlan(input: EngineInput, plan: EnginePlan): Violation[] {
  const base = input.base;
  const out: Violation[] = [];
  const { matrix } = withMargin(base.matrix, input.heights);
  const indexOf = new Map(base.places.map((p, i) => [p.id, i + 1]));
  const must = new Set(base.places.filter((p) => p.priority === "must").map((p) => p.id));

  for (const v of plan.variants) {
    const add = (rule: ViolationRule, message: string, day?: number) => out.push({ rule, variant: v.id, day, message });
    const flagged = (day: number, codes?: string[]) => [...v.option.warnings, ...plan.warnings].some((w) => w.day === day && w.severity !== "info" && (!codes || codes.includes(w.code)));

    // Every place is either planned once or left out with a reason; never both, never twice, never a must-see left out.
    const planned = v.option.days.flatMap((d) => d.stops.map((s) => s.placeId));
    const removed = v.option.removed.map((r) => r.placeId);
    if (new Set(planned).size !== planned.length) add("places", "A place is planned more than once.");
    for (const p of base.places) {
      const inPlan = planned.includes(p.id), left = removed.includes(p.id);
      if (!inPlan && !left) add("places", `${p.name} is neither planned nor listed as left out.`);
      if (inPlan && left) add("places", `${p.name} is both planned and listed as left out.`);
      if (left && must.has(p.id)) add("must_dropped", `${p.name} is a must-see but was left out.`);
    }
    for (const r of v.option.removed) if (r.reason.trim().length < 10) add("places", `${r.name} was left out without a reason.`);

    const st = styleFor(v.id, input.prefs, null).override;
    const dayLimit = (st.maxDriveMin ?? STYLES[VARIANT_STYLE[v.id]].maxDriveMin) * LONG_TRANSFER_FACTOR;
    for (const d of v.option.days) {
      const stops = [...d.stops].sort((a, b) => a.order - b.order);
      // Times run forward, and no stop is reached faster than the road (with the stated margin) allows.
      stops.forEach((s, k) => {
        if (s.visitMin <= 0 || s.waitMin < 0 || s.driveMin < 0) add("timeline", `${s.name}: a negative or zero time.`, d.day);
        if (s.departMin + SLACK < s.arriveMin + s.waitMin + s.visitMin) add("timeline", `${s.name}: leaves before its visit is over.`, d.day);
        if (k === 0) return;
        const prev = stops[k - 1];
        const gap = s.arriveMin - s.waitMin - prev.departMin;
        const i = indexOf.get(prev.placeId), j = indexOf.get(s.placeId);
        if (gap < -SLACK) add("timeline", `${s.name}: reached before leaving ${prev.name}.`, d.day);
        else if (i && j && gap + SLACK < matrix.durations[i][j] / 60) add("road_time", `${prev.name} → ${s.name}: planned in ${Math.round(gap)} min, the road (with margin) needs ${Math.round(matrix.durations[i][j] / 60)} min.`, d.day);
      });
      if (d.driveMin > dayLimit + SLACK && !flagged(d.day)) add("driving", `Day ${d.day} drives ${Math.round(d.driveMin)} min, over the ${Math.round(dayLimit)} min a long day allows, with no warning.`, d.day);
      // No driving after dark (unless allowed or flagged): every drive into a stop ends by sunset at that stop.
      if (!input.prefs.nightDriving) for (const s of stops) {
        if (s.driveMin <= 0) continue;
        const p = base.places.find((x) => x.id === s.placeId);
        const set = p ? sunsetAt(p, input.refDateISO, d.day, base.utcOffsetMin) : null;
        if (set !== null && s.arriveMin - s.waitMin > set + SLACK && !flagged(d.day, ["late_arrival"])) add("daylight", `Day ${d.day}: the drive to ${s.name} ends after sunset with no warning.`, d.day);
      }
      // Never planned on a day its known hours say it is closed, unless the plan says so.
      for (const s of stops) if (s.flags.includes("closed_at_arrival") && !flagged(d.day, ["closed_at_arrival"]) && base.places.find((p) => p.id === s.placeId)?.hours) add("closed", `${s.name} is planned on Day ${d.day} when its listed hours say closed, with no warning.`, d.day);
    }

    // Drive days: within the day's driving cap (plus the short drive into the halt town).
    const cap = transitCap(v.id, input.prefs);
    for (const t of [...v.transitOut, ...v.transitBack]) if (t.driveMin > cap + HALT_RESERVE_MIN + SLACK) add("transit_driving", `Drive day ${t.day} (${t.from} → ${t.to}) drives ${t.driveMin} min, over the ${cap} min cap.`, t.day);

    // Every night is in a named town, or the plan says to plan it yourself. The last day of the trip has no night.
    const lastDay = Math.max(0, ...v.option.days.filter((d) => d.stops.length).map((d) => d.day), ...v.transitBack.map((t) => t.day));
    for (const d of v.option.days) {
      if (!d.stops.length || d.day >= lastDay) continue;
      const continues = v.transitBack.some((t) => t.day === d.day + 1) || v.option.days.some((x) => x.day === d.day + 1 && x.stops.length);
      if (!continues) continue;                                             // the trip ends, or a spare day follows (no drive to plan)
      if (!v.halts.some((h) => h.day === d.day)) add("overnight", `The night after Day ${d.day} has no town named and no "plan this night yourself" note.`, d.day);
    }
  }
  return out;
}

/** One log line per plan with violations (server only; never shown to travellers, never blocks). */
export function logViolations(where: string, violations: Violation[]): void {
  if (!violations.length) return;
  const byRule = violations.reduce<Record<string, number>>((m, v) => ({ ...m, [v.rule]: (m[v.rule] ?? 0) + 1 }), {});
  console.warn(`[engine] validator (${where}): ${violations.length} rule(s) broken: ${JSON.stringify(byRule)}; first: ${violations[0].variant} ${violations[0].message}`);
}
