import Link from "next/link";
import type { FeedItemDTO } from "@/lib/feed/map";
import { postPath } from "@/lib/feed/share";
import { PlayIcon } from "./icons";

/** Post tiles: a swipeable row on a phone (`row`) or a grid; each opens the post's own page. Pictures load only when near the screen. */
export function PostGrid({ items, layout = "row" }: { items: FeedItemDTO[]; layout?: "row" | "grid" }) {
  const list = layout === "row"
    ? "flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden"
    : "grid grid-cols-2 gap-2 px-2 sm:grid-cols-3 sm:gap-3 sm:px-0";
  return (
    <ul className={list}>
      {items.map((it) => {
        const m = it.media.find((x) => x.type === "image") ?? it.media[0];
        const thumb = m ? (m.type === "video" ? m.posterUrl : m.url) : null;
        return (
          <li key={it.id} className={layout === "row" ? "w-40 shrink-0 snap-start sm:w-auto" : "min-w-0"}>
            <Link href={postPath(it.id)} className="block overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-md">
              <span className="relative block aspect-square bg-pine">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL
                  <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center bg-gradient-to-br from-teal to-pine p-3 text-center font-display text-sm font-semibold leading-snug text-white"><span className="line-clamp-5">{it.caption ?? it.placeName}</span></span>
                )}
                {m?.type === "video" && <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"><PlayIcon size={14} /></span>}
              </span>
              <span className="block px-3 py-2">
                <span className="block truncate text-sm font-semibold text-pine">{layout === "grid" ? it.destination.name : it.placeName}</span>
                <span className="block truncate text-xs text-ink-muted">{it.freshness.usableAsCurrent ? `Current · ${it.freshness.label}` : it.freshness.label}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
