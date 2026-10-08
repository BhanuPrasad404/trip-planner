// The rules of the "Share a destination" flow, kept apart from the screen so they can be tested.
// Pure functions only: what a post needs before it can go on, how "when was this?" turns into a time, how search results merge.
import { MEDIA_LIMITS } from "@/lib/social/media";

export type ComposeStep = "media" | "place" | "details";
export const STEPS: { id: ComposeStep; label: string }[] = [
  { id: "media", label: "Media" }, { id: "place", label: "Place" }, { id: "details", label: "Details" },
];

export type PlaceChoice = { name: string; address: string; lat: number; lng: number; source: "trailmate" | "map"; posts?: number };

/** "When was this?" Honest by design: older choices are labelled as older in the feed, never passed off as today. */
export const WHEN_OPTIONS = [
  { id: "now", label: "Just now", hoursAgo: null, appearsAs: "Just now" },
  { id: "today", label: "Earlier today", hoursAgo: 6, appearsAs: "6 hours ago" },
  { id: "yesterday", label: "Yesterday", hoursAgo: 30, appearsAs: "Yesterday" },
  { id: "week", label: "This week", hoursAgo: 96, appearsAs: "4 days ago" },
  { id: "older", label: "Older", hoursAgo: 24 * 30, appearsAs: "4 weeks ago" },
] as const;
export type WhenId = (typeof WHEN_OPTIONS)[number]["id"];

export const capturedAtFor = (id: WhenId, now: Date = new Date()): string | null => {
  const h = WHEN_OPTIONS.find((w) => w.id === id)?.hoursAgo ?? null;
  return h == null ? null : new Date(now.getTime() - h * 3_600_000).toISOString();
};

/** One tap adds a common trail/road condition to the caption — the quickest way to leave something useful for the next traveler. */
export const CONDITION_CHIPS = ["Road is clear", "Crowded", "Water flowing", "Parking full", "Muddy / slippery", "Great light", "Quiet", "Closed"] as const;
export const SPOT_CHIPS = ["Viewpoint", "Trailhead", "Waterfall", "Parking", "Temple", "Beach", "Fort", "Market"] as const;

export const CAPTION_MAX = 500;

export function appendChip(caption: string, chip: string, max = CAPTION_MAX): string {
  const base = caption.trim();
  if (base.toLowerCase().includes(chip.toLowerCase())) return caption;          // already said it
  const next = base ? `${base.replace(/[.,;]$/, "")}. ${chip}` : chip;
  return next.length > max ? caption : next;
}

export type ItemState = { status: "preparing" | "ready" | "error"; type?: "image" | "video" };
export const postKindFor = (items: ItemState[]): "photo" | "video" | "report" =>
  items.some((i) => i.type === "video") ? "video" : items.length > 0 ? "photo" : "report";

export type ComposeState = { items: ItemState[]; writtenOnly: boolean; place: PlaceChoice | null; caption: string };

/** Why the person cannot continue yet (null = they can). The same text is shown to them, so it says what to DO. */
export function blocker(step: ComposeStep, s: ComposeState): string | null {
  if (step === "media") {
    if (s.items.some((i) => i.status === "preparing")) return "Getting your files ready…";
    if (s.items.some((i) => i.status === "error")) return "Remove the file that didn't work, or add another";
    if (s.items.length === 0 && !s.writtenOnly) return "Add a photo or video — or choose a written report";
    return null;
  }
  if (step === "place") return s.place ? null : "Choose the destination";
  if (s.items.length === 0 && s.caption.trim().length === 0) return "Write what you're seeing";
  return null;
}

export const canAddMore = (items: ItemState[]) =>
  items.every((i) => i.type !== "video") && items.length < MEDIA_LIMITS.mediaPerPost;

/** Trailmate's own destinations first (instant, free), then map results; the same place is never listed twice. */
export function mergePlaces(local: PlaceChoice[], map: PlaceChoice[]): PlaceChoice[] {
  const key = (p: PlaceChoice) => `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  const seen = new Set(local.map(key));
  const km = (a: PlaceChoice, b: PlaceChoice) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const extra = map.filter((m) => !seen.has(key(m)) || !local.some((l) => key(l) === key(m) && km(l, m) < 40));
  return [...local, ...extra];
}

/** Escapes LIKE wildcards so a typed "%" or "_" searches for itself instead of matching everything. */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
