"use client";

import { Glyph } from "@/components/ui/Glyph";
import { VEHICLES, VEHICLE_LABEL, vehicleHint, type Vehicle } from "@/lib/vehicle";

const ICON = { car: "car", motorcycle: "motorbike", bus: "bus" } as const;

/** "Travelling by": the transport the route and the alerts are for. Honest about what each choice does and does not change. */
export function VehicleSelector({ value, onChange, compact = false }: { value: Vehicle; onChange: (v: Vehicle) => void; /** Icons only, for the full-screen map. */ compact?: boolean }) {
  if (compact) {
    return (
      <div role="radiogroup" aria-label="Travelling by" className="flex w-fit overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        {VEHICLES.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} title={VEHICLE_LABEL[v]} className={`grid h-11 w-12 place-items-center ${v !== "car" ? "border-l border-line" : ""} ${value === v ? "bg-pine text-white" : "text-ink-muted hover:bg-sky"}`}>
            <Glyph name={ICON[v]} size={20} /><span className="sr-only">{VEHICLE_LABEL[v]}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <section aria-labelledby="vehicle-heading" className="rounded-2xl border border-line bg-white p-3.5">
      <h2 id="vehicle-heading" className="text-sm font-semibold text-pine">Travelling by</h2>
      <div role="radiogroup" aria-labelledby="vehicle-heading" className="mt-2 grid grid-cols-3 gap-2">
        {VEHICLES.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 text-sm font-semibold transition-colors ${value === v ? "border-teal bg-teal-light/50 text-teal-ink" : "border-line text-ink-muted hover:border-teal/60"}`}>
            <Glyph name={ICON[v]} size={20} />{VEHICLE_LABEL[v]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">{vehicleHint(value)}</p>
    </section>
  );
}
