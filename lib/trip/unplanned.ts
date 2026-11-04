// The kinds of unplanned stop a traveller can record, one table for the sheet's choices, the history's words and the glyphs.
// A recorded stop goes into the journey's history only; it is added to the plan only when the traveller chooses that.
import type { GlyphName } from "@/lib/glyphs";

export const STOP_TYPES = ["food", "fuel", "sight", "stay", "emergency", "visit", "other"] as const;
export type StopType = (typeof STOP_TYPES)[number];

export const STOP_TYPE_INFO: Record<StopType, { label: string; hint: string; glyph: GlyphName; /** The planner category used if it is added to the plan. */ plan: string | null }> = {
  food: { label: "Food break", hint: "A meal, tea or a snack", glyph: "food", plan: "food" },
  fuel: { label: "Fuel", hint: "Petrol, diesel or charging", glyph: "fuel", plan: null },
  sight: { label: "Sightseeing", hint: "A temple, a view, a waterfall", glyph: "sight", plan: "other" },
  stay: { label: "A place to stay", hint: "A hotel or homestay", glyph: "stay", plan: "stay" },
  emergency: { label: "Emergency", hint: "A breakdown, medical or other urgent stop", glyph: "warn", plan: null },
  visit: { label: "Visiting someone", hint: "Friends or family", glyph: "chat", plan: null },
  other: { label: "Something else", hint: "Any other stop", glyph: "pin", plan: null },
};

export const isStopType = (v: unknown): v is StopType => typeof v === "string" && (STOP_TYPES as readonly string[]).includes(v);
