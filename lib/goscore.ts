import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import type { SeasonStatus } from "@/lib/types";
import type { Conditions } from "@/lib/weather";
import { dailyHeatBasisC, heatLevel } from "@/lib/weather-rules";

export type GoScore = {
  score: number; // 0..100
  label: "Great time" | "Good" | "Mixed" | "Poor timing";
  tone: "great" | "good" | "mixed" | "poor";
  reasons: string[];
  basis: "season+weather" | "season" | "weather";
};

const BASE: Record<SeasonStatus, number> = { good: 75, unknown: 60, wrong_season: 20 };

/**
 * Transparent, rule-based "is this a good time to go?" estimate.
 * Every point added or removed has a human-readable reason, so users can see WHY.
 * Returns null when we know nothing (no curated season data AND no weather).
 */
export function computeGoScore(input: {
  category: PlaceCategory;
  seasonStatus: SeasonStatus;
  conditions: Conditions | null;
}): GoScore | null {
  const { category, seasonStatus, conditions } = input;
  if (seasonStatus === "unknown" && !conditions) return null;

  let score = BASE[seasonStatus];
  const reasons: string[] = [];
  const rain = CATEGORIES[category].rain;

  if (seasonStatus === "good") reasons.push("In its best season");
  if (seasonStatus === "wrong_season") reasons.push("Outside its best season");

  if (conditions) {
    const t = conditions.tempMaxC;
    const p = conditions.precipMmPerDay;
    const prefix = conditions.kind === "forecast" ? "Forecast" : "Typical for these dates";
    // Heat is judged on what the body feels (lib/weather-rules.ts); "pleasant" on the air temperature. Said as plain numbers for the day
    // (a day has no hour), never as "Hot".
    const heat = dailyHeatBasisC(conditions);
    const level = heatLevel(heat.c);
    const feels = heat.feels && Math.round(heat.c) !== Math.round(t) ? ` (feels like up to ${Math.round(heat.c)}°C)` : "";
    reasons.push(`${prefix}: daytime high ${Math.round(t)}°C${feels}, ${p < 1 ? "<1" : Math.round(p)} mm rain/day`);
    if (level === "very-hot") { score -= 18; reasons.push(`Very high daytime temperature: ${Math.round(t)}°C${feels}`); }
    else if (level === "hot") { score -= 6; reasons.push(`High daytime temperature: ${Math.round(t)}°C${feels}`); }
    else if (t >= 20 && t <= 30) { score += 6; reasons.push("Pleasant temperatures"); }

    if (rain === "hates") {
      if (p >= 15) { score -= 25; reasons.push("Very heavy rain expected"); }
      else if (p >= 6) { score -= 15; reasons.push("Rain likely"); }
      else if (p >= 2) { score -= 7; reasons.push("Some rain expected"); }
      else if (conditions.rainyDayShare < 0.15) { score += 6; reasons.push("Mostly dry"); }
      if (category === "trek" && p >= 6) { score -= 8; reasons.push("Slippery, riskier trails"); }
    } else if (rain === "loves") {
      if (p < 0.8) { score -= 30; reasons.push("Likely dry — falls need rain"); }
      else if (p < 2.5) { score -= 10; reasons.push("Light flow expected"); }
      else if (p >= 40) { score -= 15; reasons.push("Extreme rain — access can be unsafe"); }
      else if (p >= 6) { score += 8; reasons.push("Rain-fed flow likely"); }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const [label, tone] =
    score >= 80 ? (["Great time", "great"] as const)
    : score >= 60 ? (["Good", "good"] as const)
    : score >= 40 ? (["Mixed", "mixed"] as const)
    : (["Poor timing", "poor"] as const);

  return { score, label, tone, reasons, basis: seasonStatus !== "unknown" && conditions ? "season+weather" : conditions ? "weather" : "season" };
}
