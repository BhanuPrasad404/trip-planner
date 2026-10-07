// "Vizag · 624 km · arrive 8:42 PM" — the numbers for the END of today's journey, built from the same road data as the
// next-stop numbers: what remains of the leg you are on (measured along the real route from your position) plus the
// road legs after it. Never a straight-line distance.
export type LaterLeg = { km: number; minutes: number };
export type Journey = { name: string; remainingKm: number; remainingMin: number; etaMs: number; stops: number };

export function journeySummary(args: {
  nowMs: number;
  /** What is left of the current leg (to the next stop), from navigation progress. */
  currentLegRemainingM: number;
  currentLegRemainingS: number;
  /** The road legs AFTER the next stop, in order. */
  laterLegs: LaterLeg[];
  /** Minutes you plan to spend at each stop on the way (the next stop's visit counts when later legs exist). */
  visitMinutes: number[];
  finalName: string;
}): Journey {
  const { laterLegs, visitMinutes } = args;
  const laterKm = laterLegs.reduce((s, l) => s + l.km, 0);
  const laterMin = laterLegs.reduce((s, l) => s + l.minutes, 0);
  const stayMin = laterLegs.length > 0 ? visitMinutes.slice(0, laterLegs.length).reduce((s, m) => s + m, 0) : 0;
  const remainingKm = Math.round((args.currentLegRemainingM / 1000 + laterKm) * 10) / 10;
  const remainingMin = Math.round(args.currentLegRemainingS / 60 + laterMin + stayMin);
  return { name: args.finalName, remainingKm, remainingMin, etaMs: args.nowMs + remainingMin * 60_000, stops: laterLegs.length + 1 };
}
