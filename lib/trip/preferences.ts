// The traveller's OWN travel preferences: how fast a day moves and whether they are willing to drive at night. They are theirs: kept on their
// phone, changed only when they change them, and never altered by anything the app learns or guesses. They shape suggestions (the day's
// start and end, whether a night arrival may be proposed); they never make a safety finding go away (a hill road after dark is never
// recommended, whatever is chosen here).
export type Pace = "relaxed" | "balanced" | "brisk";
export type TravelPrefs = { nightDriving: boolean; pace: Pace };
export const DEFAULT_PREFS: TravelPrefs = { nightDriving: false, pace: "balanced" };
export const PACES: readonly Pace[] = ["relaxed", "balanced", "brisk"];
/** The day a pace plans for, as minutes after midnight. */
export const PACE_WINDOW: Record<Pace, { dayStartMin: number; dayEndMin: number }> = {
  relaxed: { dayStartMin: 9 * 60, dayEndMin: 18 * 60 + 30 },
  balanced: { dayStartMin: 8 * 60, dayEndMin: 20 * 60 },
  brisk: { dayStartMin: 7 * 60, dayEndMin: 21 * 60 },
};
export const PACE_LABEL: Record<Pace, string> = { relaxed: "Relaxed: start later, finish earlier", balanced: "Balanced", brisk: "Brisk: start early, go on later" };
export const prefsKey = (userId: string) => `tm:travel-prefs:${userId}`;

/** Saved preferences read back: anything missing or damaged falls back to the default, one field at a time. Never throws. */
export function parsePrefs(raw: unknown): TravelPrefs {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof TravelPrefs, unknown>>;
  return { nightDriving: v.nightDriving === true, pace: PACES.includes(v.pace as Pace) ? (v.pace as Pace) : DEFAULT_PREFS.pace };
}
