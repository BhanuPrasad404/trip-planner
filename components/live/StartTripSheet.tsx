"use client";

// "Start my trip": says plainly what tapping it does BEFORE it does it, then records the real departure time. It never needs GPS: with
// no location the trip is followed by what the traveller tells us. Starting late, or after a missed day, is normal and is said so.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Glyph } from "@/components/ui/Glyph";
import { PickerSheet } from "@/components/ui/Sheet";
import type { DepartureTiming } from "@/lib/trip/live-phase";

type Props = {
  from: string | null;
  timing: DepartureTiming;
  /** A precise live position is available right now. */
  hasLocation: boolean;
  /** Records the departure; resolves with what happened. */
  onConfirm: () => Promise<"saved" | "queued" | "failed">;
  onClose: () => void;
};

export function StartTripSheet({ from, timing, hasLocation, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const late = timing.kind === "late";
  const go = async () => {
    setBusy(true); setFailed(false);
    const r = await onConfirm();
    setBusy(false);
    if (r === "failed") setFailed(true); else onClose();
  };
  return (
    <PickerSheet title="Start my trip" onClose={onClose} footer={
      <div className="flex flex-col gap-2">
        <Button className="min-h-12 w-full text-base" onClick={() => void go()} loading={busy} loadingLabel="Saving…"><Glyph name="navigate" size={18} />Start my trip now</Button>
        <Button variant="ghost" className="min-h-11 w-full" onClick={onClose} disabled={busy}>Not yet</Button>
      </div>
    }>
      <div className="space-y-4 px-4 py-4 text-sm">
        <p className="text-base text-pine">{from ? <>Setting off from <strong>{from}</strong>.</> : "Tap start when you are on your way."}</p>
        {timing.kind !== "unknown" && <p className={`rounded-xl px-3 py-2 ${late ? "bg-marigold-light text-marigold-ink" : "bg-sky text-ink-muted"}`}>{timing.text}{late && " Starting late is fine."}</p>}
        <div>
          <p className="font-semibold text-pine">When you tap Start</p>
          <ul className="mt-1.5 space-y-1.5 text-ink-muted">
            <li className="flex gap-2"><Glyph name="check" size={16} className="mt-0.5 shrink-0 text-teal" />We save <strong className="text-pine">this moment</strong> as your real departure time.</li>
            <li className="flex gap-2"><Glyph name="check" size={16} className="mt-0.5 shrink-0 text-teal" />We start following your progress against the plan.</li>
            <li className="flex gap-2"><Glyph name="check" size={16} className="mt-0.5 shrink-0 text-teal" />{late ? "We then check whether your plan still works and offer options. Nothing changes unless you approve it." : "Your plan does not change."}</li>
          </ul>
        </div>
        <p className="flex gap-2 text-xs text-ink-muted"><Glyph name="locate" size={15} className="mt-0.5 shrink-0" />{hasLocation ? "Your location is used to show the distance to your next stop and to notice arrivals. We keep how accurate it was, never a trail of where you went." : "Location isn't on, so that's fine: you can start and follow the trip by tapping. Turn location on any time for distances and arrival prompts."}</p>
        {failed && <p role="alert" className="text-xs font-semibold text-clay-ink">That couldn&apos;t be saved. Try again.</p>}
      </div>
    </PickerSheet>
  );
}
