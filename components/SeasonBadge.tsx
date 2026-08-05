import { SeasonStatus } from "@/lib/types";

export function SeasonBadge({ status }: { status: SeasonStatus }) {
  if (status === "good") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-teal-light text-teal">
        ● Good now
      </span>
    );
  }
  if (status === "wrong_season") {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-clay-light text-clay">
        ⚠ Wrong season
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-line text-ink-soft">
      ? Unknown
    </span>
  );
}
