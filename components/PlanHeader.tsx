import { Glyph } from "@/components/ui/Glyph";

export type PlanTool = "plan" | "leave" | "import" | "dates" | "group";

/**
 * The top of the Plan page, kept to what a traveller needs first: when, how big, and the three things they can do.
 * The trip's NAME is not repeated here: the trip layout above already shows it as the page's heading (a second one cost a line of
 * phone screen and gave the page two level-1 headings).
 * Everything else is one tap away in a panel that opens below, one at a time, so the page opens on the itinerary.
 */
export function PlanHeader({ dates, meta, status, countdown, active, onTool, hasDates }: {
  /** "Thu, 15 Oct to Fri, 16 Oct" or "No dates yet" */
  dates: string;
  /** "2 days · 4 places" */
  meta: string;
  /** One line about driving, or null. */
  status: string | null;
  /** "Starts tomorrow", "Day 2 of your trip", "Trip dates have passed", or null. */
  countdown: string | null;
  active: PlanTool | null;
  onTool: (t: PlanTool) => void;
  hasDates: boolean;
}) {
  const tools: { id: Exclude<PlanTool, "dates" | "group">; label: string; icon: "navigate" | "car" | "sparkles"; primary?: boolean }[] = [
    { id: "plan", label: "Plan my trip", icon: "navigate", primary: true },
    { id: "leave", label: "When to leave", icon: "car" },
    { id: "import", label: "Import places", icon: "sparkles" },
  ];
  return (
    <header className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-pine">{dates}</p>
            <p className="text-sm text-ink-muted">{meta}{status ? ` · ${status}` : ""}</p>
          </div>
          <button type="button" aria-pressed={active === "dates"} onClick={() => onTool("dates")} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${active === "dates" ? "border-teal bg-teal-light/50 text-teal-ink" : hasDates ? "border-line text-pine hover:bg-sky" : "border-marigold bg-marigold-light text-[#7a4a00]"}`}>
            <Glyph name="calendar" size={16} />{hasDates ? "Dates" : "Set dates"}
          </button>
        </div>
        {countdown && <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sky px-3 py-1 text-xs font-semibold text-pine"><Glyph name="info" size={13} />{countdown}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Planning tools">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={active === t.id}
              onClick={() => onTool(t.id)}
              className={`flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-xl px-1.5 text-center text-[13px] font-bold leading-tight transition-colors ${
                active === t.id ? "bg-pine text-white" : t.primary ? "bg-marigold text-pine hover:bg-[#f0b254]" : "border border-line bg-white text-pine hover:bg-teal-light"
              }`}
            >
              <Glyph name={t.icon} size={18} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={active === "group"} onClick={() => onTool("group")} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline-offset-2 ${active === "group" ? "text-teal-ink" : "text-pine underline"}`}>
          <Glyph name="chat" size={15} />Ask your group: their pace, interests and things to avoid
        </button>
      </div>
    </header>
  );
}
