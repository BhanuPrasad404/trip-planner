// Every number that shapes a plan lives here, with the reason it exists. A "travel style" is only a different set of
// these numbers fed to the SAME optimiser — there is no separate algorithm per style. Change a number → bump BUILDER_VERSION.
import type { PlaceCategory } from "@/lib/categories";

export const BUILDER_VERSION = "trip-builder-2026.10.1";
export const MAX_BUILDER_PLACES = 40; // the routing "table" request is limited, and a 40-stop plan is already beyond one trip

export type Priority = "must" | "high" | "normal" | "optional";
export const PRIORITIES: Priority[] = ["must", "high", "normal", "optional"];
export const PRIORITY_LABEL: Record<Priority, string> = { must: "Must do", high: "Important", normal: "Normal", optional: "Maybe" };
/** How much a stop is worth when we must drop something. "must" is never dropped (it is a constraint, not a score). */
export const PRIORITY_VALUE: Record<Priority, number> = { must: 1_000, high: 3, normal: 2, optional: 1 };

export type StyleId = "balanced" | "relaxed" | "explorer" | "scenic" | "photography" | "family" | "roadtrip";

export type StyleConfig = {
  id: StyleId;
  label: string;
  tagline: string;
  /** Minutes after local midnight. */
  dayStartMin: number;
  dayEndMin: number;
  /** Meals and rest inside the day window (not available for driving/sightseeing). */
  mealMin: number;
  /** Most driving + sightseeing + buffers we are willing to put in one day (fatigue limit, not just clock time). */
  capacityMin: number;
  /** Most driving in one day. A single unavoidable long transfer may exceed it by LONG_TRANSFER_FACTOR. */
  maxDriveMin: number;
  /** Multiplies the default time spent at each kind of place. */
  visitFactor: number;
  /** Parking, walking in, photos, toilets — added after every stop. */
  bufferPerStopMin: number;
  /** Extra share on top of routing drive time: fuel, tea breaks, slow patches. Routing times are for a clear road. */
  driveBufferShare: number;
  /** How much saved DRIVING counts when deciding what to drop (a road-tripper enjoys the drive: < 1). */
  driveWeight: number;
  /** Liking for kinds of places in this style. */
  appeal: Partial<Record<PlaceCategory, number>>;
  /** How hard to try to arrive at viewpoints/beaches near sunset. */
  goldenWeight: number;
};

export const LONG_TRANSFER_FACTOR = 1.4;
export const CLUSTER_LINK_MIN = 55; // places this close BY ROAD are one natural area
export const CLUSTER_SPLIT_PENALTY = 0.35; // cost (in "day-loads") of cutting a cluster across two days
export const MAX_PERMUTE = 7; // stops per day we try every order for (7! = 5040)

const BASE = { mealMin: 90, driveBufferShare: 0.1, bufferPerStopMin: 10 } as const;

export const STYLES: Record<StyleId, StyleConfig> = {
  balanced: { id: "balanced", label: "Balanced", tagline: "A good mix of places and driving", dayStartMin: 510, dayEndMin: 1200, ...BASE, capacityMin: 540, maxDriveMin: 360, visitFactor: 1, driveWeight: 1, appeal: {}, goldenWeight: 0.6 },
  relaxed: { id: "relaxed", label: "Relaxed", tagline: "Fewer places, less driving, more time at each", dayStartMin: 540, dayEndMin: 1140, ...BASE, capacityMin: 420, maxDriveMin: 240, visitFactor: 1.25, driveWeight: 1.3, appeal: {}, goldenWeight: 0.6 },
  explorer: { id: "explorer", label: "Explorer", tagline: "As many of your places as realistically fit", dayStartMin: 480, dayEndMin: 1260, ...BASE, capacityMin: 660, maxDriveMin: 480, visitFactor: 0.85, driveWeight: 0.8, appeal: {}, goldenWeight: 0.4 },
  scenic: { id: "scenic", label: "Scenic", tagline: "Viewpoints, water and hills first", dayStartMin: 510, dayEndMin: 1200, ...BASE, capacityMin: 540, maxDriveMin: 360, visitFactor: 1.1, driveWeight: 1, appeal: { viewpoint: 1.4, lake: 1.3, waterfall: 1.3, hill_station: 1.3, beach: 1.15 }, goldenWeight: 0.9 },
  photography: { id: "photography", label: "Photography", tagline: "Be at the right place at golden hour", dayStartMin: 450, dayEndMin: 1230, ...BASE, capacityMin: 540, maxDriveMin: 330, visitFactor: 1.15, driveWeight: 1, appeal: { viewpoint: 1.4, beach: 1.3, lake: 1.3, fort: 1.2, waterfall: 1.2 }, goldenWeight: 1.6 },
  family: { id: "family", label: "Family", tagline: "Shorter drives, gentler days", dayStartMin: 540, dayEndMin: 1140, ...BASE, capacityMin: 450, maxDriveMin: 270, visitFactor: 1.2, driveWeight: 1.2, appeal: { trek: 0.5, wildlife: 0.9, museum: 1.1, beach: 1.1, activity: 1.2 }, goldenWeight: 0.4 },
  roadtrip: { id: "roadtrip", label: "Road trip", tagline: "The drive is part of the point", dayStartMin: 480, dayEndMin: 1230, ...BASE, capacityMin: 600, maxDriveMin: 450, visitFactor: 0.9, driveWeight: 0.55, appeal: { viewpoint: 1.2 }, goldenWeight: 0.6 },
};

/** The three plans shown side by side. Others can be chosen from the style list. */
export const DEFAULT_OPTION_STYLES: StyleId[] = ["balanced", "relaxed", "explorer"];

/** Places where timing around sunset matters. */
export const GOLDEN_CATEGORIES: PlaceCategory[] = ["viewpoint", "beach", "lake", "hill_station"];
/** Minutes before sunset that make the "golden" window: [sunset − 80, sunset − 10]. */
export const GOLDEN_WINDOW: [number, number] = [80, 10];

/** Load thresholds (share of the day's capacity) behind the words comfortable / moderate / heavy / overloaded. */
export const INTENSITY = { comfortable: 0.6, moderate: 0.85, heavy: 1.0 } as const;
