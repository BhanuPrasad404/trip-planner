// Fuel (decision 2): litres first, from the traveller's mileage (defaults shown as "change to your vehicle's"). Rupees only when the
// traveller types today's fuel price — we never guess a price.
import { DEFAULT_MILEAGE_KM_PER_L } from "./rules";
import type { TravelMode } from "@/lib/intake/types";

export const defaultMileage = (mode: TravelMode): number | null => (mode === "car" || mode === "bike" ? DEFAULT_MILEAGE_KM_PER_L[mode] : null);

/** Litres for `km` at `kmPerL` (rounded up to a whole litre), or null when there is no own vehicle or no sane mileage. */
export function litres(km: number, kmPerL: number | null): number | null {
  if (kmPerL === null || !Number.isFinite(kmPerL) || kmPerL <= 0 || !Number.isFinite(km) || km < 0) return null;
  return Math.ceil(km / kmPerL);
}

/** Rupees for those litres at the price the traveller typed. Null without a price: no guessing. */
export function fuelCost(l: number | null, pricePerL: number | null): number | null {
  if (l === null || pricePerL === null || !Number.isFinite(pricePerL) || pricePerL <= 0) return null;
  return Math.round(l * pricePerL);
}

export const fuelLabel = (mode: TravelMode, kmPerL: number | null): string =>
  kmPerL === null
    ? "Fuel isn't worked out: you aren't driving your own vehicle."
    : `Fuel is worked out at ${kmPerL} km per litre${kmPerL === defaultMileage(mode) ? ` (a typical ${mode}; change it to your vehicle's)` : " (your vehicle)"}. Rupees appear only after you enter today's fuel price.`;
