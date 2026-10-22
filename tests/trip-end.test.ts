import { describe, expect, it } from "vitest";
import { builderEndMode, routeLabel, tripEndMarker, tripEndPoint } from "@/lib/trip/end";
import { createTripSchema } from "@/lib/validation/schemas";

const base = { start_city: "Hyderabad", start_lat: 17.38, start_lng: 78.48, dest_name: null as string | null, dest_lat: null as number | null, dest_lng: null as number | null };

describe("how a trip ends — one answer for Plan, Live and Map", () => {
  it("return to start: the end is home, no separate end marker, the builder adds the drive home", () => {
    const t = { ...base, end_mode: "start" as const };
    expect(tripEndPoint(t)).toEqual({ lat: 17.38, lng: 78.48, label: "Back to Hyderabad" });
    expect(tripEndMarker(t)).toBeNull();
    expect(builderEndMode(t)).toBe("start");
    expect(routeLabel(t)).toBe("Hyderabad · round trip");
  });
  it("end at a place: that place", () => {
    const t = { ...base, end_mode: "place" as const, dest_name: "Panaji", dest_lat: 15.49, dest_lng: 73.83 };
    expect(tripEndPoint(t)).toEqual({ lat: 15.49, lng: 73.83, label: "Panaji" });
    expect(builderEndMode(t)).toBe("point");
    expect(routeLabel(t)).toBe("Hyderabad → Panaji");
  });
  it("open-ended: no end at all, even if an old destination is still stored", () => {
    const t = { ...base, end_mode: "open" as const, dest_name: "Old", dest_lat: 15, dest_lng: 74 };
    expect(tripEndPoint(t)).toBeNull();
    expect(builderEndMode(t)).toBe("free");
    expect(routeLabel(t)).toBe("From Hyderabad");
  });
  it("trips made before this change (no end_mode) behave exactly as before", () => {
    const t = { ...base, dest_name: "Warangal", dest_lat: 17.97, dest_lng: 79.59 };
    expect(tripEndPoint(t)).toEqual({ lat: 17.97, lng: 79.59, label: "Warangal" });
    expect(builderEndMode(t)).toBe("free");
    expect(routeLabel(t)).toBe("Hyderabad → Warangal");
    expect(tripEndPoint({ ...base, end_mode: null })).toBeNull();
  });
});

describe("creating a trip: the end choice is checked on the server", () => {
  const ok = { name: "Goa", num_days: 3, start_city: "Hyderabad", start_lat: 17.38, start_lng: 78.48 };
  it("'end at a place' without the place is refused", () => {
    expect(createTripSchema.safeParse({ ...ok, end_mode: "place" }).success).toBe(false);
  });
  it("'return to start' and 'open' never keep a stray destination (Live would otherwise drive to it)", () => {
    for (const mode of ["start", "open"] as const) {
      const r = createTripSchema.safeParse({ ...ok, end_mode: mode, dest_name: "Panaji", dest_lat: 15.49, dest_lng: 73.83 });
      expect(r.success).toBe(true);
      expect(r.data).toMatchObject({ end_mode: mode, dest_name: null, dest_lat: null, dest_lng: null });
    }
  });
  it("an unknown mode is refused; no mode at all is the old form and still works", () => {
    expect(createTripSchema.safeParse({ ...ok, end_mode: "somewhere" }).success).toBe(false);
    expect(createTripSchema.safeParse(ok).success).toBe(true);
  });
});
