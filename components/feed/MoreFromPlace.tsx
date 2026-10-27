import type { FeedItemDTO } from "@/lib/feed/map";
import { PostGrid } from "./PostGrid";

/** Other posts from the same destination: a row you can swipe on a phone, a grid on a larger screen. */
export function MoreFromPlace({ destination, items }: { destination: string; items: FeedItemDTO[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="more-heading" className="mt-8">
      <h2 id="more-heading" className="mb-3 px-4 font-display text-xl font-semibold text-pine sm:px-0">More from {destination}</h2>
      <PostGrid items={items} layout="row" />
    </section>
  );
}
