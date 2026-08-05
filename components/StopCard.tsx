import { Place, getSeasonStatus } from "@/lib/types";
import { SeasonBadge } from "./SeasonBadge";

type StopCardProps = {
  place: Place;
  seasonReason?: string | null;
  goodMonths?: number[] | null;
  onSwap?: (placeId: string) => void;
};

export function StopCard({ place, seasonReason, goodMonths, onSwap }: StopCardProps) {
  const status = getSeasonStatus(goodMonths);

  return (
    <div className="flex gap-3 py-3 border-b border-line last:border-b-0">
      <div className="font-mono text-[11px] text-ink-soft w-[42px] pt-0.5 shrink-0">
        {place.arrival_time?.slice(0, 5) ?? "--:--"}
      </div>
      <div className="flex-1">
        <div className="text-[14.5px] font-semibold mb-1">{place.name}</div>
        <SeasonBadge status={status} />
        {status === "wrong_season" && seasonReason && (
          <div className="text-[11.5px] text-ink-soft mt-1.5 leading-relaxed">
            {seasonReason}
          </div>
        )}
        {place.notes && status !== "wrong_season" && (
          <div className="text-[11.5px] text-ink-soft mt-1.5 leading-relaxed">
            {place.notes}
          </div>
        )}
        {status === "wrong_season" && onSwap && (
          <button
            onClick={() => onSwap(place.id)}
            className="text-[10.5px] font-bold text-clay underline mt-1.5"
          >
            Swap this stop →
          </button>
        )}
      </div>
    </div>
  );
}
