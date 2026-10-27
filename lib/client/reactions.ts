// Like / save / "this helped me decide", for both the feed and the post page: instant on screen, then the server's number wins,
// and if the server says no the screen goes back with a plain message. The pure parts are tested without a browser.
import type { FeedItemDTO } from "@/lib/feed/map";

export type ReactionKind = "like" | "save" | "helpful";
const FLAG = { like: "liked", save: "saved", helpful: "helped" } as const;
const COUNT = { like: "likes", save: "saves", helpful: "helpful" } as const;
const VERB = { like: "like", save: "save", helpful: "mark" } as const;

/** The post with one reaction switched; `total` (the server's number) replaces the local count. */
export function withReaction(item: FeedItemDTO, kind: ReactionKind, on: boolean, total?: number): FeedItemDTO {
  const count = COUNT[kind];
  return { ...item, me: { ...item.me, [FLAG[kind]]: on }, counts: { ...item.counts, [count]: total ?? Math.max(0, item.counts[count] + (on ? 1 : -1)) } };
}

export type ReactionAnswer = { likes: number; saves: number; helpful: number };

export async function sendReaction(postId: string, kind: ReactionKind, on: boolean, doFetch: typeof fetch = fetch): Promise<ReactionAnswer> {
  let res: Response;
  try {
    res = await doFetch(`/api/posts/${postId}/reaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, on }) });
  } catch { throw new Error(`Couldn't ${VERB[kind]} that. Check your connection.`); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 404 ? "This post isn't available any more." : body?.error ?? `Couldn't ${VERB[kind]} that. Please try again.`);
  return body as ReactionAnswer;
}

export const serverCount = (kind: ReactionKind, a: ReactionAnswer) => (kind === "like" ? a.likes : kind === "save" ? a.saves : a.helpful);
