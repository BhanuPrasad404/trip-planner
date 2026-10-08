import { freshnessOf } from "@/lib/social/freshness";
import { BookmarkIcon, CommentIcon, HeartIcon, PinIcon } from "../icons";

type Props = {
  imageUrl: string | null;
  destination: string | null;
  spot: string;
  caption: string;
  capturedAt: string | null;
  precision: "approx" | "exact";
  isVideo: boolean;
  photoCount: number;
};

const dot = { green: "bg-emerald-400", amber: "bg-marigold", grey: "bg-white/60" } as const;

/** What the post will look like in the feed, updating as you type. Purely visual (hidden from screen readers; the form itself is the accessible part). */
export function PostPreview({ imageUrl, destination, spot, caption, capturedAt, precision, isVideo, photoCount }: Props) {
  const now = new Date();
  const f = freshnessOf(capturedAt ?? now, capturedAt, now);
  const area = [spot.trim() && spot.trim().toLowerCase() !== destination?.toLowerCase() ? spot.trim() : null, precision === "approx" ? "approximate area" : null].filter(Boolean).join(" · ");
  return (
    <div aria-hidden="true" className="relative aspect-[9/16] w-full max-w-[250px] overflow-hidden rounded-[28px] bg-pine text-white shadow-2xl ring-1 ring-white/15">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-teal via-[#14675f] to-pine">
          {caption && <p className="flex h-full items-center px-5 text-center font-display text-lg font-semibold leading-snug">{caption.slice(0, 120)}</p>}
        </div>
      )}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1.5 p-2.5">
        <span className="flex min-w-0 items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
          <PinIcon size={12} className="shrink-0" /><span className="truncate">{destination ?? "Your destination"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold backdrop-blur">
          <span className={`h-1.5 w-1.5 rounded-full ${dot[f.dot]}`} />{f.usableAsCurrent ? `Current · ${f.label}` : f.label}
        </span>
      </div>

      {(isVideo || photoCount > 1) && (
        <span className="absolute left-2.5 top-11 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">{isVideo ? "Video" : `${photoCount} photos`}</span>
      )}

      <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white/90">
        <HeartIcon size={20} /><CommentIcon size={20} /><BookmarkIcon size={20} />
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-1 p-3 pr-10">
        <p className="font-display text-base font-semibold leading-tight">{destination ?? <span className="text-white/55">Choose a destination</span>}</p>
        {area && <p className="text-[10px] text-white/80">{area}</p>}
        {imageUrl && <p className="line-clamp-2 text-[11px] leading-snug text-white/90">{caption || <span className="text-white/50">Your caption appears here</span>}</p>}
        <p className="pt-0.5 text-[10px] text-white/70">@you</p>
        <div className="flex gap-1.5 pt-1.5">
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-pine">Add to trip</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold backdrop-blur">Open map</span>
        </div>
      </div>
    </div>
  );
}
