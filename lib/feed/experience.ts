// The structured part of a travel post: what it was like, in a handful of one-tap facts. One vocabulary, used by the database
// (the same lists are in the migration's CHECK constraints — a test keeps them identical), the API validation and the screens.

export const CROWD_LEVELS = ["quiet", "moderate", "crowded"] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];
export const CROWD_LABEL: Record<CrowdLevel, string> = { quiet: "Quiet", moderate: "Moderate", crowded: "Crowded" };
/** A crowd report is about "right now": it stops counting as current after this many hours. */
export const CROWD_TTL_HOURS = 24;

// `ttlHours`: how long a report of this kind stays true enough to show as current. A queue clears in hours; a closed road lasts days.
export const CONDITIONS = [
  { id: "rainy", label: "Raining", ttlHours: 6 },
  { id: "sunny", label: "Clear & sunny", ttlHours: 8 },
  { id: "foggy", label: "Foggy", ttlHours: 8 },
  { id: "muddy", label: "Muddy / slippery", ttlHours: 24 },
  { id: "road_good", label: "Road is good", ttlHours: 24 },
  { id: "road_bad", label: "Road is bad", ttlHours: 24 },
  { id: "construction", label: "Construction", ttlHours: 72 },
  { id: "closed", label: "Closed", ttlHours: 12 },
  { id: "long_queue", label: "Long queue", ttlHours: 4 },
  { id: "parking_full", label: "Parking full", ttlHours: 4 },
] as const;
export type ConditionId = (typeof CONDITIONS)[number]["id"];
export const CONDITION_IDS = CONDITIONS.map((c) => c.id) as unknown as readonly [ConditionId, ...ConditionId[]];
export const conditionLabel = (id: string) => CONDITIONS.find((c) => c.id === id)?.label ?? id;
export const conditionTtlMs = (id: string) => (CONDITIONS.find((c) => c.id === id)?.ttlHours ?? 12) * 3_600_000;
/** Conditions that mean "think twice" — shown in a warning colour. */
export const WARNING_CONDITIONS: ReadonlySet<string> = new Set(["closed", "road_bad", "construction", "long_queue", "parking_full", "muddy"]);

export const VIBES = [
  { id: "best_view", label: "Best view" }, { id: "hidden_gem", label: "Hidden gem" }, { id: "food", label: "Food" },
  { id: "adventure", label: "Adventure" }, { id: "photography", label: "Photography" }, { id: "peaceful", label: "Peaceful" },
  { id: "family", label: "Family-friendly" }, { id: "budget", label: "Budget-friendly" }, { id: "romantic", label: "Romantic" },
  { id: "sunrise", label: "Sunrise" }, { id: "sunset", label: "Sunset" },
] as const;
export type VibeId = (typeof VIBES)[number]["id"];
export const VIBE_IDS = VIBES.map((v) => v.id) as unknown as readonly [VibeId, ...VibeId[]];
export const vibeLabel = (id: string) => VIBES.find((v) => v.id === id)?.label ?? id;

export const LIMITS = { conditions: 6, vibes: 5, tipMin: 3, tipMax: 160 } as const;

export type Experience = { crowd: CrowdLevel | null; conditions: string[]; vibes: string[]; tip: string | null; fromArea: boolean };
export const emptyExperience: Experience = { crowd: null, conditions: [], vibes: [], tip: null, fromArea: false };

/** Did the traveler tell us anything beyond the picture? Drives "planning" ranking and the "useful" badge. */
export const hasTravelDetail = (e: Pick<Experience, "crowd" | "conditions" | "vibes" | "tip">) => !!(e.tip || e.crowd || e.conditions.length || e.vibes.length);
