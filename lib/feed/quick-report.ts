// "How was it?" — the one-tap report asked when a traveler marks a stop done. Pure rules, tested without a browser:
// what makes a report worth sending, the words it says (only what the traveler tapped or typed), and when NOT to ask.
import { CROWD_LABEL, conditionLabel, type CrowdLevel } from "./experience";

/** The conditions worth one tap at the end of a visit (the full list stays in the share flow). */
export const QUICK_CONDITIONS = ["road_good", "road_bad", "parking_full", "long_queue", "closed", "rainy", "muddy"] as const;
export const NOTE_MAX = 280;

export type QuickInput = {
  place: { name: string; lat: number; lng: number };
  crowd: CrowdLevel | null;
  conditions: string[];
  note: string;
  /** The phone's position right now, if the traveler already allowed it: earns "posted from the area". Never stored. */
  device: { lat: number; lng: number } | null;
};

/** The words of the report: what they typed, or else exactly what they tapped ("Quiet. Road is good."). Never invented. */
export function quickCaption(crowd: CrowdLevel | null, conditions: string[]): string {
  const parts = [crowd ? `Crowd: ${CROWD_LABEL[crowd].toLowerCase()}` : null, ...conditions.map(conditionLabel)].filter(Boolean) as string[];
  return parts.length ? `${parts.join(". ")}.` : "";
}

export type QuickResult = { ok: true; body: Record<string, unknown> } | { ok: false; reason: string };

export function buildQuickReport(i: QuickInput): QuickResult {
  const note = i.note.trim().slice(0, NOTE_MAX);
  const conditions = [...new Set(i.conditions.filter((c) => (QUICK_CONDITIONS as readonly string[]).includes(c)))];
  if (!i.crowd && conditions.length === 0 && note.length < 3) return { ok: false, reason: "Tap one thing, or write a few words." };
  const name = i.place.name.trim().slice(0, 120);
  if (name.length < 2 || !Number.isFinite(i.place.lat) || !Number.isFinite(i.place.lng)) return { ok: false, reason: "This stop has no place to post about." };
  return {
    ok: true,
    body: {
      kind: "report", caption: note || quickCaption(i.crowd, conditions), place_name: name, destination_name: name,
      lat: i.place.lat, lng: i.place.lng, location_precision: "approx",
      crowd: i.crowd, conditions, vibes: [], tip: null,
      device_lat: i.device?.lat ?? null, device_lng: i.device?.lng ?? null, media: [],
    },
  };
}

// ── when to ask ───────────────────────────────────────────────────────────────
const ASKED = "trailmate.quick.asked.v1";
const MUTED = "trailmate.quick.muted.v1";
const KEEP = 200;
type Store = Pick<Storage, "getItem" | "setItem">;

/** Ask once per stop, never after "Don't ask me after stops", and never when storage cannot be read (better silent than nagging). */
export function shouldAsk(store: Store | null, placeId: string): boolean {
  if (!store) return false;
  try {
    if (store.getItem(MUTED) === "1") return false;
    const asked = JSON.parse(store.getItem(ASKED) ?? "[]") as unknown;
    return !(Array.isArray(asked) && asked.includes(placeId));
  } catch { return false; }
}
export function markAsked(store: Store | null, placeId: string): void {
  if (!store) return;
  try {
    const raw = JSON.parse(store.getItem(ASKED) ?? "[]") as unknown;
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x !== placeId) : [];
    store.setItem(ASKED, JSON.stringify([...list, placeId].slice(-KEEP)));
  } catch { /* nothing to do */ }
}
export function muteAsking(store: Store | null): void { try { store?.setItem(MUTED, "1"); } catch { /* ignore */ } }
