// "Will it fit?" — the live meter on the questions screens. It runs the REAL fit check of the planning engine
// (lib/trip-builder/brief.ts: real road times, visit times, day limits, dropping what can't fit, must-sees never dropped) every time an
// answer changes. Pure and fast (a few ms for a normal trip), so it runs on the phone; the road times are fetched once per set of places.
// It checks driving and time only — opening hours, weather and night driving are checked when the trip is planned, and it says so.
import { SETTLEMENT_VISIT_MIN } from "@/lib/engine/settlement";
import type { PlaceCategory } from "@/lib/categories";
import { withMargin } from "@/lib/engine/margin";
import { evaluateBrief, type BriefConstraints, type BriefFit } from "@/lib/trip-builder/brief";
import type { PlaceHit } from "@/lib/places/types";
import type { TripAnswers } from "./types";

export type MeterPlace = { id: string; name: string; lat: number; lng: number; kind: PlaceHit["kind"]; must: boolean };
export type Matrix = { durations: number[][]; distances: number[][]; source: string; estimatedPairs?: number };

export type MeterLevel = "easy" | "tight" | "over" | "unknown";
export type Meter = {
  level: MeterLevel;
  /** One line, in words (never colour alone): "Fits easily", "Doesn't all fit: 5 of 7 places in 3 days". */
  headline: string;
  detail: string;
  /** Days that would fit everything (when the days are not enough). */
  needDays: number | null;
  kept: number;
  total: number;
  /** 0–1 how full the days are (null when not computed). */
  fullness: number | null;
  driveMin: number;
  km: number;
  /** Names left out, with the engine's reason. */
  leftOut: { name: string; reason: string }[];
  estimated: boolean;
};

/**
 * A town or city written as a "place" is not a monument: the same time the planner gives it (lib/engine/settlement.ts), so this meter
 * and the plan agree. A city is many sights; a town or village is a short stop. Null for every other kind (its category decides).
 */
export function settlementMinutes(p: { name: string; kind: PlaceHit["kind"] }): number | null {
  if (categoryFor(p) !== "other") return null;
  return p.kind === "city" ? SETTLEMENT_VISIT_MIN.city : p.kind === "town" || p.kind === "village" ? SETTLEMENT_VISIT_MIN.town : p.kind === "subdistrict" || p.kind === "district" ? SETTLEMENT_VISIT_MIN.area : null;
}

/** Which kind of place, for its typical visit time. From the name first ("…Falls"), then the map's kind. */
export function categoryFor(p: { name: string; kind: PlaceHit["kind"] }): PlaceCategory {
  const n = p.name.toLowerCase();
  if (/\b(falls?|waterfalls?|jalapatham|jharna|aruvi)\b/.test(n)) return "waterfall";
  if (/\b(temple|mandir|gudi|kovil|koil|devasthana|church|mosque|masjid|dargah|gurudwara|basilica)\b/.test(n)) return "temple";
  if (/\b(fort|kota|qila|kila|palace)\b/.test(n)) return "fort";
  if (/\b(caves?|museum)\b/.test(n)) return "museum";
  if (/\b(beach)\b/.test(n)) return "beach";
  if (/\b(lake|dam|reservoir|cheruvu|tank|sagar)\b/.test(n)) return "lake";
  if (/\b(view ?point|sunset point|sunrise point)\b/.test(n)) return "viewpoint";
  if (/\b(national park|wildlife|sanctuary|tiger reserve|safari)\b/.test(n)) return "wildlife";
  switch (p.kind) {
    case "water": return "lake";
    case "coast": return "beach";
    case "hill": return "viewpoint";
    case "park": return "wildlife";
    default: return "other";
  }
}

const UNKNOWN = (headline: string, detail = ""): Meter => ({ level: "unknown", headline, detail, needDays: null, kept: 0, total: 0, fullness: null, driveMin: 0, km: 0, leftOut: [], estimated: false });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const hours = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.round((min / 60) * 10) / 10} h`);

/**
 * `places` and `matrix` must line up: matrix row/column 0 = the start, then the places in this order.
 * A whole state is never a stop (it is left out of the check and said so on screen).
 */
export function fitMeter(input: { answers: TripAnswers; start: { lat: number; lng: number; name: string } | null; places: MeterPlace[]; matrix: Matrix | null; startDateISO?: string | null }): Meter {
  const { answers, start, places, matrix } = input;
  if (!start) return UNKNOWN("Add where you start", "Then we can check the driving.");
  if (places.length === 0) return UNKNOWN("Add places to see if it fits");
  if (!answers.days) return UNKNOWN("How many days?", "Tell us the number of days and we'll check it fits.");
  if (!matrix || matrix.durations.length !== places.length + 1) return UNKNOWN("Checking the roads…");

  const constraints: BriefConstraints = {
    days: answers.days, maxDriveHours: answers.maxDriveHours ?? null, pace: answers.pace ?? null,
    returnToStart: answers.endMode === "start", mustSee: places.filter((p) => p.must).map((p) => p.name),
  };
  const fit: BriefFit = evaluateBrief({
    candidates: places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: categoryFor(p), confidence: 1, must: p.must, visitMin: settlementMinutes(p) })),
    start: { lat: start.lat, lng: start.lng, label: start.name },
    // The SAME road margin the plan adds (+15% on every drive, lib/engine/margin.ts), so the meter and the plan stop disagreeing about how long
    // the roads take. Heights are not known here, so no hill drive is guessed: a hill trip is checked more strictly when it is planned.
    numDays: answers.days, startDateISO: input.startDateISO ?? null, utcOffsetMin: 330, constraints, matrix: withMargin(matrix, null).matrix,
  });

  const total = places.length;
  const kept = fit.keptIds.length;
  const dropped = fit.dropped.filter((d) => d.code !== "duplicate");
  const leftOut = dropped.map((d) => ({ name: d.name, reason: d.reason }));
  // A place left out because ONE drive to it is longer than a day can hold won't fit with more days: don't promise that.
  const tooFar = dropped.some((d) => d.code === "too_far" || d.code === "wrong_direction");
  const needDays = tooFar ? null : fit.stats.minDaysForAll;
  const base = { needDays, kept, total, fullness: fit.stats.utilization, driveMin: fit.stats.driveMin, km: Math.round(fit.stats.km), leftOut, estimated: matrix.source === "estimate" };
  const driving = `About ${hours(fit.stats.driveMin)} of driving (${Math.round(fit.stats.km)} km) in total.`;

  // The engine says "fits" about the places that passed its first screen; places screened out (too far for a day's drive) still mean
  // the traveller's list does NOT all fit.
  if (dropped.length && (fit.verdict === "fits" || fit.verdict === "fits_after_cuts")) {
    const why = tooFar ? `${dropped.filter((d) => d.code === "too_far").map((d) => d.name).join(", ") || "Some places"} ${dropped.filter((d) => d.code === "too_far").length === 1 ? "is" : "are"} too far for one day's drive at your limits.` : needDays ? `All of them need about ${plural(needDays, "day")}.` : "";
    return { ...base, level: "over", headline: `Doesn't all fit: ${kept} of ${total} places in ${plural(answers.days, "day")}`, detail: `${why} ${driving}`.trim() };
  }

  switch (fit.verdict) {
    case "fits": {
      const heavy = (fit.plan?.days ?? []).some((d) => d.intensity === "heavy" || d.intensity === "overloaded");
      const tight = heavy || (fit.stats.utilization ?? 0) > 0.85;
      return { ...base, level: tight ? "tight" : "easy", headline: tight ? `Fits, but the days are full` : `Fits easily in ${plural(answers.days, "day")}`, detail: driving };
    }
    case "needs_more_days":
      return { ...base, level: "over", headline: fit.headline, detail: "Add days, or change a must-see." };
    case "impossible":
      return { ...base, level: "over", headline: fit.headline, detail: fit.detail };
    default:
      return UNKNOWN(fit.headline || "We couldn't check this yet", fit.detail);
  }
}
