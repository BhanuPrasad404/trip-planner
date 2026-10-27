// Links an Explore place to the traveller feed (a "destination") and says how fresh its reports are. Pure.
// Honesty rules:
//   • a place is linked only to a destination that is really the same place: very close (400 m), or close (2 km) with a matching name
//   • the count is of posts the person may see (the database decides), never a guess
//   • an old report is said to be old; it is never presented as how things are now
import { distanceKm } from "@/lib/geo";

export type DestinationRow = { id: string; name: string; lat: number; lng: number };
export type PostStamp = { destination_id: string; created_at: string; captured_at: string | null };
export type Community = { destinationId: string; name: string; posts: number; recent: number; latestAt: string | null };

const SAME_SPOT_KM = 0.4;
const SAME_NAME_KM = 2;
/** Posts in the last 30 days count as "recent". */
export const RECENT_DAYS = 30;

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\u0900-\u0dff]+/g, " ").trim();
const STOP = new Set(["the", "of", "and", "sri", "shri", "temple", "fort", "falls", "lake", "beach", "view", "point", "park", "national", "hills", "hill", "dam", "caves", "cave"]);
const words = (s: string) => new Set(fold(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));

/** Do two names name the same place? One contains the other, or they share a distinctive word ("Borra Caves" / "Borra Guhalu"). */
export function sameName(a: string, b: string): boolean {
  const fa = fold(a), fb = fold(b);
  if (!fa || !fb) return false;
  if (fa === fb || fa.includes(fb) || fb.includes(fa)) return true;
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
}

/** The destination for each place (by place id), or nothing. The nearest qualifying one wins. */
export function matchDestinations(items: { id: string; name: string; lat: number; lng: number }[], dests: DestinationRow[]): Map<string, DestinationRow> {
  const out = new Map<string, DestinationRow>();
  for (const it of items) {
    let best: { d: DestinationRow; km: number } | null = null;
    for (const d of dests) {
      const km = distanceKm(it, d);
      const ok = km <= SAME_SPOT_KM || (km <= SAME_NAME_KM && sameName(it.name, d.name));
      if (ok && (!best || km < best.km)) best = { d, km };
    }
    if (best) out.set(it.id, best.d);
  }
  return out;
}

/** The moment a post is about: when the photo was taken if earlier, else when it was posted (a backdated photo never counts as new). */
const takenAt = (p: PostStamp) => { const a = Date.parse(p.created_at), b = p.captured_at ? Date.parse(p.captured_at) : NaN; return Number.isFinite(b) ? Math.min(a, b) : a; };

export function summarize(dest: DestinationRow, posts: PostStamp[], nowMs: number): Community {
  const mine = posts.filter((p) => p.destination_id === dest.id && Number.isFinite(Date.parse(p.created_at)));
  const times = mine.map(takenAt).filter(Number.isFinite);
  const latest = times.length ? Math.max(...times) : null;
  return { destinationId: dest.id, name: dest.name, posts: mine.length, recent: times.filter((t) => nowMs - t <= RECENT_DAYS * 86_400_000).length, latestAt: latest === null ? null : new Date(latest).toISOString() };
}

export function ageText(ms: number): string {
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** One line for the card, and how fresh it is (the card's colour follows it, but the words say it too). */
export function communityLine(c: Community, nowMs: number): { text: string; fresh: "new" | "recent" | "old" | "none" } {
  if (c.posts === 0 || !c.latestAt) return { text: "No traveller reports yet", fresh: "none" };
  const age = nowMs - Date.parse(c.latestAt);
  const n = `${c.posts} traveller report${c.posts === 1 ? "" : "s"}`;
  if (age <= 3 * 86_400_000) return { text: `${n} · latest ${ageText(age)}`, fresh: "new" };
  if (age <= RECENT_DAYS * 86_400_000) return { text: `${n} · latest ${ageText(age)}`, fresh: "recent" };
  return { text: `${n} · latest ${ageText(age)}, may be out of date`, fresh: "old" };
}
