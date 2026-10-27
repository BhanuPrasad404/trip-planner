// Remember the feed for a few minutes, so opening a post and pressing Back brings the person to the same place in the same
// posts, instead of a fresh feed from the top. Stored per tab (sessionStorage), never sent anywhere, and dropped when it is old
// (the picture links are signed for one hour), damaged, or for a different trip or mode. The storage is passed in: tested without a browser.
import type { FeedItemDTO } from "@/lib/feed/map";

export const SNAPSHOT_TTL_MS = 15 * 60_000;
/**
 * Picture links are signed for 60 minutes when a page is FETCHED. Saving the feed again (every scroll does) does not make its links
 * any newer, so a feed whose oldest page is older than this never comes back: it would show black videos and empty photos.
 */
export const LINKS_SAFE_MS = 40 * 60_000;
/** A feed this large is not worth keeping (the browser's storage is small); the feed then simply starts again. */
export const SNAPSHOT_MAX_CHARS = 1_500_000;
const KEY = "trailmate.feed.snapshot.v1";

export type Snapshot = {
  key: string;
  savedAt: number;
  items: FeedItemDTO[];
  nextCursor: string | null;
  coldStart: boolean;
  notice: string | null;
  tripDestinations: string[];
  scrollY: number;
  /** When the oldest page of this feed was fetched (its picture links were signed then). */
  fetchedAt: number;
};

export const snapshotKey = (tripId: string | null, intent: string) => `${tripId ?? "-"}|${intent}`;

type Writer = Pick<Storage, "setItem" | "removeItem">;
type Reader = Pick<Storage, "getItem" | "removeItem">;

export function saveSnapshot(store: Writer, snap: Snapshot): boolean {
  try {
    if (snap.items.length === 0) { store.removeItem(KEY); return false; }
    const text = JSON.stringify(snap);
    if (text.length > SNAPSHOT_MAX_CHARS) { store.removeItem(KEY); return false; }
    store.setItem(KEY, text);
    return true;
  } catch { return false; }          // private mode or a full store: the feed just starts fresh next time
}

const isItem = (x: unknown): x is FeedItemDTO => {
  const i = x as Partial<FeedItemDTO> | null;
  return !!i && typeof i.id === "string" && typeof i.destination?.id === "string" && Array.isArray(i.media) && typeof i.counts?.likes === "number";
};

export function loadSnapshot(store: Reader, key: string, now: number): Snapshot | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Snapshot>;
    const ok = s && s.key === key && typeof s.savedAt === "number" && now - s.savedAt >= 0 && now - s.savedAt <= SNAPSHOT_TTL_MS
      && typeof s.fetchedAt === "number" && now - s.fetchedAt >= 0 && now - s.fetchedAt <= LINKS_SAFE_MS
      && Array.isArray(s.items) && s.items.length > 0 && s.items.every(isItem) && Array.isArray(s.tripDestinations)
      && (s.nextCursor === null || typeof s.nextCursor === "string") && typeof s.scrollY === "number" && Number.isFinite(s.scrollY);
    if (!ok) { store.removeItem(KEY); return null; }
    return { key, savedAt: s.savedAt!, items: s.items!, nextCursor: s.nextCursor ?? null, coldStart: !!s.coldStart, notice: typeof s.notice === "string" ? s.notice : null, tripDestinations: s.tripDestinations!.filter((d) => typeof d === "string"), scrollY: Math.max(0, s.scrollY!), fetchedAt: s.fetchedAt! };
  } catch { try { store.removeItem(KEY); } catch { /* nothing more to do */ } return null; }
}

export const clearSnapshot = (store: Pick<Storage, "removeItem">) => { try { store.removeItem(KEY); } catch { /* ignore */ } };

type Both = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A change made on the post page (a like, a delete) must show when the person goes Back: edit the remembered feed in place. */
export function updateSnapshot(store: Both, change: (items: FeedItemDTO[]) => FeedItemDTO[]): void {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Snapshot;
    if (!Array.isArray(s.items)) return;
    const items = change(s.items);
    if (items.length === 0) { store.removeItem(KEY); return; }
    store.setItem(KEY, JSON.stringify({ ...s, items }));
  } catch { /* the feed just starts fresh */ }
}

// ── post heights (for windowed scrolling) ────────────────────────────────────
// Posts far off screen are replaced by empty boxes of the same height. Their heights are remembered with the feed, so going Back
// lands on the same post even though most of the posts are not drawn.
const HEIGHTS = "trailmate.feed.heights.v1";
const MAX_HEIGHTS = 400;

export function saveHeights(store: Pick<Storage, "setItem">, heights: Map<string, number>): void {
  try {
    const entries = [...heights].filter(([, h]) => Number.isFinite(h) && h > 0 && h < 20_000).slice(-MAX_HEIGHTS);
    store.setItem(HEIGHTS, JSON.stringify(Object.fromEntries(entries.map(([k, h]) => [k, Math.round(h)]))));
  } catch { /* nothing to do */ }
}
export function loadHeights(store: Pick<Storage, "getItem">): Map<string, number> {
  try {
    const raw = JSON.parse(store.getItem(HEIGHTS) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
    return new Map(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0 && e[1] < 20_000));
  } catch { return new Map(); }
}

/** Which posts are drawn: always the first few (so the first screen never waits), and every post near the screen. */
export const ALWAYS_DRAWN = 3;
export const shouldDraw = (index: number, id: string, near: ReadonlySet<string>) => index < ALWAYS_DRAWN || near.has(id);
/** Height of a post that has never been drawn: about one card. */
export const ESTIMATED_HEIGHT = 760;
