"use client";

import type { FeedItemDTO } from "@/lib/feed/map";
import { compact } from "@/lib/feed/people";
import { BookmarkIcon, BulbIcon, CommentIcon, HeartIcon, ShareIcon } from "./icons";

export type ActionHandlers = {
  onLike: (on: boolean) => void;
  onSave: (on: boolean) => void;
  onHelpful: (on: boolean) => void;
  onComments: () => void;
  onShare: () => void;
};

const BTN = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold tabular-nums text-ink transition-transform active:scale-90 hover:bg-sky motion-reduce:transition-none";

/** The row of things you can do with a post. Real buttons with names and pressed states; the count is part of the name. */
export function ActionBar({ item, ...on }: { item: Pick<FeedItemDTO, "me" | "counts" | "isMine" | "canComment"> } & ActionHandlers) {
  const { me, counts } = item;
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Post actions">
      <button type="button" onClick={() => on.onLike(!me.liked)} aria-pressed={me.liked} aria-label={me.liked ? "Remove like" : "Like"} className={BTN}>
        <HeartIcon filled={me.liked} size={24} className={me.liked ? "text-clay" : ""} />
        {counts.likes > 0 && <span aria-hidden="true">{compact(counts.likes)}</span>}
        {counts.likes > 0 && <span className="sr-only">{counts.likes} likes</span>}
      </button>
      <button type="button" onClick={on.onComments} aria-label={`Comments (${counts.comments})`} className={BTN}>
        <CommentIcon size={24} />
        {counts.comments > 0 && <span aria-hidden="true">{compact(counts.comments)}</span>}
      </button>
      <button type="button" onClick={on.onShare} aria-label="Share" className={BTN}><ShareIcon size={23} /></button>
      <span className="flex-1" />
      {!item.isMine && (
        <button type="button" onClick={() => on.onHelpful(!me.helped)} aria-pressed={me.helped} aria-label={me.helped ? "Remove helpful mark" : "This helped me decide"}
          className={`${BTN} ${me.helped ? "bg-marigold-light" : ""}`}>
          <BulbIcon filled={me.helped} size={22} className={me.helped ? "text-marigold" : ""} />
          <span className="hidden min-[400px]:inline">Helpful</span>
          {counts.helpful > 0 && <span aria-hidden="true">{compact(counts.helpful)}</span>}
        </button>
      )}
      <button type="button" onClick={() => on.onSave(!me.saved)} aria-pressed={me.saved} aria-label={me.saved ? "Remove from saved" : "Save"} className={BTN}>
        <BookmarkIcon filled={me.saved} size={24} className={me.saved ? "text-marigold" : ""} />
      </button>
    </div>
  );
}
