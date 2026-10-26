// What is true about TODAY for this trip, in one plain sentence, with the real choices for when to start (worked out from the clock, the
// sunset and the traveller's own rule about driving after dark). Dates only change when the traveller taps one.
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import type { StartOption } from "@/lib/result/start-options";
import type { TripClock } from "@/lib/result/trip-clock";

export function TripClockBanner({ clock, options, canEdit, busy, onPick }: { clock: TripClock; options: StartOption[]; canEdit: boolean; busy: boolean; onPick: (o: StartOption) => void }) {
  if (!clock.headline) return null;
  const choose = clock.action !== null && options.length > 0;
  return (
    <div role="status" className={`rounded-xl border px-3.5 py-3 ${choose ? "border-marigold/50 bg-marigold-light/60" : "border-line bg-sky"}`}>
      <p className="flex items-start gap-2 text-sm font-medium text-pine"><Glyph name={choose ? "warn" : "info"} size={16} className="mt-0.5 shrink-0" />{clock.headline}</p>
      {choose && canEdit && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{clock.state === "after" ? "Do this trip again from" : "When do you want to start?"}</p>
          {options.map((o) => (
            <Button key={o.id} variant={o.best ? "primary" : "secondary"} className="h-auto min-h-12 w-full flex-col items-start py-2 text-left" disabled={busy} onClick={() => onPick(o)}>
              <span className="font-semibold">{o.label}{o.best ? " · best" : ""}</span>
              <span className="text-xs font-normal opacity-90">{o.detail}</span>
            </Button>
          ))}
        </div>
      )}
      {choose && !canEdit && <p className="mt-1.5 text-xs text-ink-muted">Only the trip owner can change the start.</p>}
    </div>
  );
}
