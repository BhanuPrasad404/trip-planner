// Place categories drive default visit durations and how weather affects the Go Score.

export type PlaceCategory =
  | "waterfall" | "trek" | "fort" | "lake" | "beach" | "temple" | "viewpoint"
  | "hill_station" | "wildlife" | "activity" | "museum" | "food" | "stay" | "other";

type RainEffect = "loves" | "hates" | "neutral";

export const CATEGORIES: Record<PlaceCategory, { label: string; emoji: string; hours: number; rain: RainEffect }> = {
  waterfall: { label: "Waterfall", emoji: "💧", hours: 2, rain: "loves" },
  trek: { label: "Trek", emoji: "🥾", hours: 5, rain: "hates" },
  fort: { label: "Fort", emoji: "🏰", hours: 2.5, rain: "hates" },
  lake: { label: "Lake / dam", emoji: "🏞️", hours: 2, rain: "hates" },
  beach: { label: "Beach", emoji: "🏖️", hours: 3, rain: "hates" },
  temple: { label: "Temple / heritage", emoji: "🛕", hours: 1.5, rain: "hates" },
  viewpoint: { label: "Viewpoint", emoji: "🌄", hours: 1, rain: "hates" },
  hill_station: { label: "Hill station", emoji: "⛰️", hours: 3, rain: "hates" },
  wildlife: { label: "Wildlife", emoji: "🐅", hours: 4, rain: "hates" },
  activity: { label: "Activity", emoji: "🎢", hours: 3, rain: "hates" },
  museum: { label: "Museum / caves", emoji: "🏛️", hours: 2, rain: "neutral" },
  food: { label: "Food", emoji: "🍛", hours: 1.5, rain: "neutral" },
  stay: { label: "Stay", emoji: "🛏️", hours: 0.5, rain: "neutral" },
  other: { label: "Place", emoji: "📍", hours: 2, rain: "hates" },
};

const ALIASES: Record<string, PlaceCategory> = {
  waterfalls: "waterfall", falls: "waterfall", cascade: "waterfall",
  trekking: "trek", hike: "trek", hiking: "trek", peak: "trek", mountain: "trek",
  fortress: "fort", castle: "fort", heritage: "temple", temples: "temple", shrine: "temple", religious: "temple",
  dam: "lake", reservoir: "lake", river: "lake",
  beaches: "beach", coast: "beach",
  view: "viewpoint", sunset_point: "viewpoint", point: "viewpoint",
  hill: "hill_station", hills: "hill_station", hillstation: "hill_station", "hill station": "hill_station",
  safari: "wildlife", national_park: "wildlife", sanctuary: "wildlife", park: "wildlife",
  adventure: "activity", amusement: "activity", resort: "stay", hotel: "stay", homestay: "stay", camp: "stay",
  restaurant: "food", cafe: "food", dhaba: "food",
  cave: "museum", caves: "museum", monument: "museum", city: "other", town: "other",
};

export function normalizeCategory(raw: string | null | undefined): PlaceCategory {
  const k = (raw ?? "").trim().toLowerCase();
  if (k in CATEGORIES) return k as PlaceCategory;
  return ALIASES[k] ?? "other";
}
