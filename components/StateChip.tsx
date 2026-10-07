import { STATE_LABEL, type TripState } from "@/lib/trip-state";

const STYLE: Record<TripState, string> = {
  draft: "bg-sky text-ink-muted",
  upcoming: "bg-marigold-light text-[#7a4a00]",
  active: "bg-teal-light text-teal-ink",
  completed: "bg-line text-ink-muted",
};

export function StateChip({ state }: { state: TripState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STYLE[state]}`}>
      {state === "active" && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-teal" />}
      {STATE_LABEL[state]}
    </span>
  );
}
