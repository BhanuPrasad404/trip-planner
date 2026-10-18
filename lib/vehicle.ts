// The traveller's actual transport. It changes what we SAY and what we ask the routing service for; it never lets us claim more than we know.
//   car         the routing service's driving routes, as they are.
//   motorcycle  the same road network, but asked to avoid motorway-class roads (access-controlled expressways), where two-wheelers are
//               generally not allowed. That is a rule of thumb from the type of road, NOT a check of each road's own rules.
//   bus         the same car routes. We have no bus-specific data: bus restrictions, height or width limits and stops are NOT checked.
export type Vehicle = "car" | "motorcycle" | "bus";
export const VEHICLES: Vehicle[] = ["car", "motorcycle", "bus"];
export const VEHICLE_LABEL: Record<Vehicle, string> = { car: "Car", motorcycle: "Motorcycle", bus: "Bus" };
export const DEFAULT_VEHICLE: Vehicle = "car";
/** Per PERSON and trip: on a shared phone each person keeps their own choice. */
export const vehicleKey = (userId: string, tripId: string) => `tm:vehicle:${userId}:${tripId}`;
/** Where the choice was kept before it was per person (read once, then moved). */
export const legacyVehicleKey = (tripId: string) => `tm:vehicle:${tripId}`;

export const isVehicle = (v: unknown): v is Vehicle => v === "car" || v === "motorcycle" || v === "bus";
export function parseVehicle(raw: unknown): Vehicle {
  if (isVehicle(raw)) return raw;
  if (typeof raw === "string") { try { const j = JSON.parse(raw) as { vehicle?: unknown } | string | null; if (isVehicle(j)) return j; if (j && typeof j === "object" && isVehicle(j.vehicle)) return j.vehicle; } catch { /* damaged: use the default */ } }
  return DEFAULT_VEHICLE;
}

/** Does this vehicle ask the router to avoid motorway-class roads? */
export const avoidsMotorway = (v: Vehicle): boolean => v === "motorcycle";

/**
 * One honest sentence about how well the route fits this vehicle. `applied` is whether the routing service really did what we asked
 * (the free service may not support avoiding motorways: then it is a car route and we say so).
 */
export function routeFitNote(v: Vehicle, applied: boolean): string {
  if (v === "car") return "Routes and times are for a car at typical speeds, without live traffic.";
  if (v === "motorcycle") return applied
    ? "This route avoids motorway-class roads, where two-wheelers are usually not allowed. That comes from the type of road, not from each road's own rules, so look out for signs. Times are for a car."
    : "We couldn't ask for a route that avoids expressways, so this is a car route. Check that two-wheelers are allowed on it. Times are for a car.";
  return "This is a car route. We have no bus-specific data, so bus restrictions, height and width limits and stops are NOT checked. A bus is usually slower than the time shown.";
}

/** Google Maps' own travel mode for the hand-off link. Google has a two-wheeler mode; it has none for your own bus, so that stays driving. */
export const googleTravelMode = (v: Vehicle): "driving" | "two-wheeler" => (v === "motorcycle" ? "two-wheeler" : "driving");

/** What to say under the selector BEFORE any route exists: what changes for this vehicle, and what does not. No claim about a particular route. */
export function vehicleHint(v: Vehicle): string {
  if (v === "car") return "Routes and times are for a car.";
  if (v === "motorcycle") return "We ask for routes that avoid expressways, where two-wheelers are usually not allowed. Each road's own rules aren't checked.";
  return "Routes are car routes. Bus restrictions, size limits and stops aren't checked.";
}
