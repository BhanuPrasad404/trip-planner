// When a picture fails, its link has most likely expired (links last an hour). Ask for fresh links for that post AND the posts just
// after it (theirs were signed at the same time, so they are about to fail too): one request instead of one per post.
import type { FeedItemDTO, MediaDTO } from "@/lib/feed/map";

export const REFRESH_BATCH = 12;

/** The failing post first, then the next ones on screen, at most one batch. */
export function idsToRefresh(items: Pick<FeedItemDTO, "id" | "media">[], failedId: string): string[] {
  const at = items.findIndex((i) => i.id === failedId);
  const after = at < 0 ? [] : items.slice(at + 1).filter((i) => i.media.length > 0).map((i) => i.id);
  return [failedId, ...after].slice(0, REFRESH_BATCH);
}

export async function fetchFreshMedia(ids: string[], doFetch: typeof fetch = fetch): Promise<Map<string, MediaDTO[]> | null> {
  try {
    const res = await doFetch("/api/feed/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { media?: Record<string, MediaDTO[]> } | null;
    if (!body?.media || typeof body.media !== "object") return null;
    return new Map(Object.entries(body.media).filter(([, m]) => Array.isArray(m)));
  } catch { return null; }
}

/** True when the fresh links really are different (otherwise retrying would just fail again). */
export const linksChanged = (before: MediaDTO[], after: MediaDTO[] | undefined) =>
  !!after && after.length > 0 && after.some((m, i) => m.url !== before[i]?.url);
