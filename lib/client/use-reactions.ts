"use client";

import { useCallback, useRef } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { sendReaction, serverCount, withReaction, type ReactionKind } from "./reactions";

/** Returns `react(item, kind, on)`: updates the screen at once through `patch`, confirms with the server, and reverts with a message on failure. */
export function useReactions(patch: (id: string, fn: (i: FeedItemDTO) => FeedItemDTO) => void, onError: (message: string) => void) {
  const pending = useRef(new Set<string>());
  return useCallback((item: FeedItemDTO, kind: ReactionKind, on: boolean) => {
    const key = `${item.id}:${kind}`;
    if (pending.current.has(key)) return;                       // a second tap while the first is on its way is ignored, never doubled
    pending.current.add(key);
    patch(item.id, (i) => withReaction(i, kind, on));
    sendReaction(item.id, kind, on)
      .then((answer) => patch(item.id, (i) => ({ ...i, counts: { ...i.counts, [kind === "like" ? "likes" : kind === "save" ? "saves" : "helpful"]: serverCount(kind, answer) } })))
      .catch((e: unknown) => {
        patch(item.id, (i) => withReaction(i, kind, !on, item.counts[kind === "like" ? "likes" : kind === "save" ? "saves" : "helpful"]));
        onError(e instanceof Error ? e.message : "That didn't work. Please try again.");
      })
      .finally(() => pending.current.delete(key));
  }, [patch, onError]);
}
