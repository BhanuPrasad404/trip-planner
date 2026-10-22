// Permit areas. We have NO live permit data, so these notes only say a permit MAY be needed and always end with the same sentence
// (the traveller's rule): never a status, never "open"/"closed", never a fee. Areas are matched from the place's state (GeoNames) and,
// inside a state, from rough map areas that are written out below.
import { distanceKm } from "@/lib/geo";

export const PERMIT_CHECK = "Rules change, check the official site before you go.";

type Rule = { test: (p: { lat: number; lng: number; state: string | null }) => boolean; text: (names: string) => string };

const inState = (s: string) => (p: { state: string | null }) => p.state === s;
const near = (lat: number, lng: number, km: number) => (p: { lat: number; lng: number }) => distanceKm(p, { lat, lng }) <= km;

const RULES: Rule[] = [
  { test: inState("Arunachal Pradesh"), text: (n) => `${n}: Arunachal Pradesh may need an Inner Line Permit (ILP) for Indian visitors.` },
  { test: inState("Nagaland"), text: (n) => `${n}: Nagaland may need an Inner Line Permit (ILP) for Indian visitors.` },
  { test: inState("Mizoram"), text: (n) => `${n}: Mizoram may need an Inner Line Permit (ILP) for Indian visitors.` },
  { test: inState("Manipur"), text: (n) => `${n}: Manipur may need an Inner Line Permit (ILP) for Indian visitors.` },
  { test: inState("Lakshadweep"), text: (n) => `${n}: Lakshadweep may need an entry permit.` },
  // North Sikkim (Lachen, Lachung, Gurudongmar, Yumthang) and the Nathu La / Tsomgo side of East Sikkim.
  { test: (p) => p.state === "Sikkim" && (p.lat >= 27.55 || (p.lng >= 88.7 && p.lat >= 27.3)), text: (n) => `${n}: this part of Sikkim may need a protected-area permit, usually arranged through a registered tour operator.` },
  // Ladakh beyond the Leh area (Nubra, Pangong, Tso Moriri, Hanle…).
  { test: (p) => p.state === "Ladakh" && !near(34.16, 77.58, 30)(p) && !near(34.56, 76.13, 15)(p), text: (n) => `${n}: this part of Ladakh may need a protected-area permit (Inner Line Permit).` },
  { test: (p) => p.state === "Andaman and Nicobar" && p.lat < 10.0, text: (n) => `${n}: the Nicobar islands are restricted; a visit may need special permission.` },
  { test: (p) => p.state === "Andaman and Nicobar" && p.lat >= 10.0, text: (n) => `${n}: some Andaman islands and tribal reserve areas are restricted or need a permit.` },
  { test: near(32.37, 77.25, 10), text: (n) => `${n}: driving to Rohtang Pass may need an online vehicle permit.` },
];

/** One line per permit area touched by the trip, naming the places. Every line ends with PERMIT_CHECK. */
export function permitNotes(places: { name: string; lat: number; lng: number; state: string | null }[]): string[] {
  const out: string[] = [];
  for (const r of RULES) {
    const hit = places.filter((p) => r.test(p)).map((p) => p.name);
    if (hit.length) out.push(`${r.text(hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` and ${hit.length - 3} more` : ""))} ${PERMIT_CHECK}`);
  }
  return out;
}
