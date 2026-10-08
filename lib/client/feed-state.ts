import type { FeedItemDTO } from "@/lib/feed/map";

// The feed screen's state as a pure reducer: easy to test, and the one place that decides what "loading", "error" and "end" mean.
export type FeedStatus = "loading" | "ready" | "loadingMore" | "error" | "end";
export type FeedState = { items: FeedItemDTO[]; status: FeedStatus; error: string | null; nextCursor: string | null; coldStart: boolean; /** Why the feed is empty, when the server knows (e.g. "My trip" with no places). */ notice: string | null };

export type FeedAction =
  | { type: "load" }
  | { type: "more" }
  | { type: "loaded"; items: FeedItemDTO[]; nextCursor: string | null; coldStart: boolean; append: boolean; notice?: string | null }
  | { type: "failed"; message: string }
  | { type: "patch"; id: string; fn: (i: FeedItemDTO) => FeedItemDTO }
  | { type: "remove"; id: string };

export const initialFeed: FeedState = { items: [], status: "loading", error: null, nextCursor: null, coldStart: false, notice: null };

export function feedReducer(s: FeedState, a: FeedAction): FeedState {
  switch (a.type) {
    case "load": return { ...initialFeed };
    case "more": return s.status === "ready" ? { ...s, status: "loadingMore", error: null } : s;
    case "loaded": {
      const have = new Set(a.append ? s.items.map((i) => i.id) : []);
      const fresh = a.items.filter((i) => !have.has(i.id));                       // never show the same post twice
      const items = a.append ? [...s.items, ...fresh] : fresh;
      return { items, nextCursor: a.nextCursor, coldStart: a.coldStart, notice: a.notice ?? null, error: null, status: a.nextCursor === null ? "end" : "ready" };
    }
    // A failed first load is a full error screen; a failed "more" keeps everything already loaded and offers a retry at the end.
    case "failed": return { ...s, status: "error", error: a.message };
    case "patch": return { ...s, items: s.items.map((i) => (i.id === a.id ? a.fn(i) : i)) };
    case "remove": return { ...s, items: s.items.filter((i) => i.id !== a.id) };
  }
}
