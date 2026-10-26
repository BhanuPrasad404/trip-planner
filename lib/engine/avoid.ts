// "Anything to avoid?" → rules the planner can really use. The answers arrive as the labels shown on the screen ("Long drives"),
// or as the traveller's own words read by the AI ("no long drives", "not too many early mornings"), so both are understood here.
// Only things we can act on become rules; "crowded places" is not one (we have no crowd data), so it is not asked for.
import { AVOID_LABEL, type AvoidId } from "@/lib/intake/group";

const LABEL_TO_ID = new Map<string, AvoidId>((Object.entries(AVOID_LABEL) as [AvoidId, string][]).map(([id, label]) => [label.toLowerCase(), id]));

export function parseAvoid(raw: unknown): AvoidId[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<AvoidId>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.toLowerCase().trim();
    const exact = LABEL_TO_ID.get(t);
    if (exact) { out.add(exact); continue; }
    if (/night/.test(t) && /(driv|ride|travel)/.test(t)) out.add("night_driving");
    else if (/(long|too (much|many)|lots of).{0,12}(driv|ride|journey|travel)|(driv|ride).{0,12}(long|too much)/.test(t)) out.add("long_drives");
    else if (/early|sunrise|dawn|crack of/.test(t)) out.add("early_starts");
    else if (/trek|hik|walk|climb|steep/.test(t)) out.add("long_walks");
    else if (/crowd|rush|busy/.test(t)) out.add("crowds");
  }
  return [...out];
}
