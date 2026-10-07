import { WHEN_LABEL, type WhenKind } from "@/lib/time-context";

const tone: Record<WhenKind, string> = {
  now: "bg-teal-light text-teal-ink",
  forecast: "bg-sky text-pine",
  typical: "bg-line text-ink-muted",
  arrival: "bg-sky text-pine",
  planned: "bg-line text-ink-muted",
  reported: "bg-marigold-light text-[#7a4a00]",
  historical: "bg-line text-ink-muted",
};

/** Small label that says WHAT KIND of fact this is and WHEN it applies: "Forecast · Wed 7 Oct", "Now · updated 4 min ago". */
export function WhenChip({ kind, detail, className }: { kind: WhenKind; detail?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[kind]} ${className ?? ""}`}>
      {WHEN_LABEL[kind]}
      {detail && <span className="font-normal">· {detail}</span>}
    </span>
  );
}
