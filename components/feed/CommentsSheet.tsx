"use client";

import type { FeedItemDTO } from "@/lib/feed/map";
import { CommentsPanel } from "./CommentsPanel";
import { Sheet } from "./Sheet";

export function CommentsSheet({ item, onClose, onPosted }: { item: FeedItemDTO; onClose: () => void; onPosted: () => void }) {
  return (
    <Sheet title={`Comments${item.counts.comments ? ` · ${item.counts.comments}` : ""}`} onClose={onClose}>
      <div className="min-h-[40dvh]"><CommentsPanel item={item} onPosted={onPosted} /></div>
    </Sheet>
  );
}
