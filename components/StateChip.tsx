import { STATE_LABEL, type TripOutcome, type TripState } from "@/lib/trip-state";

const STYLE: Record<TripState | "ended", string> = {
  draft: "bg-sky text-ink-muted",
  upcoming: "bg-marigold-light text-[#7a4a00]",
  active: "bg-teal-light text-teal-ink",
  completed: "bg-line text-ink-muted",
  ended: "bg-line text-ink-muted",
};

/** `outcome` (when known) says "Ended" for a past trip where nothing was marked done, instead of calling it "Completed". */
export function StateChip({ state, outcome }: { state: TripState; outcome?: TripOutcome }) {
  const kind = outcome?.kind ?? state;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STYLE[kind]}`}>
      {state === "active" && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-teal" />}
      {outcome?.label ?? STATE_LABEL[state]}
    </span>
  );
}
