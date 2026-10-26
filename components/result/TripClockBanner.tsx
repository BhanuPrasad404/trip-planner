// What is true about TODAY for this trip, in one plain sentence, with the one tap that helps (never changes dates on its own).
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { TripClock } from "@/lib/result/trip-clock";

export function TripClockBanner({ clock, canEdit, busy, onStartTomorrow }: { clock: TripClock; canEdit: boolean; busy: boolean; onStartTomorrow: (startISO: string) => void }) {
  if (!clock.headline) return null;
  const bad = clock.state === "after" || (clock.action !== null && clock.state === "today");
  return (
    <div role="status" className={`rounded-xl border px-3.5 py-3 ${bad ? "border-marigold/50 bg-marigold-light/60" : "border-line bg-sky"}`}>
      <p className="flex items-start gap-2 text-sm font-medium text-pine"><Glyph name={bad ? "warn" : "info"} size={16} className="mt-0.5 shrink-0" />{clock.headline}</p>
      {clock.action && canEdit && <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={() => onStartTomorrow(clock.action!.startISO)}>{clock.action.label}</Button>}
    </div>
  );
}
