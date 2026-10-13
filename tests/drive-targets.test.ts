import { describe, expect, it } from "vitest";
import { DESTINATION_ID, destinationBelongsToDrive, planDriveTargets } from "@/lib/map/drive-targets";

const dest = { lat: 17.6868, lng: 83.2185, name: "Visakhapatnam" };
const stop = (id: string, lat: number, lng: number, arrival: string | null = null) => ({ id, name: `Stop ${id}`, lat, lng, arrival_time: arrival });

describe("planDriveTargets — where does the drive go?", () => {
  it("a trip with a start and a destination but NO stops navigates to the destination (the reported bug)", () => {
    const t = planDriveTargets({ remaining: [], destination: dest, driveDay: 1, numDays: 3, scheduledStopCount: 0 });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: DESTINATION_ID, kind: "destination", name: "Visakhapatnam", lat: dest.lat, lng: dest.lng });
  });

  it("with stops, the destination comes after them on the last day, in order", () => {
    const t = planDriveTargets({ remaining: [stop("a", 17.9, 79.6, "10:30:00"), stop("b", 18.3, 82.9)], destination: dest, driveDay: 2, numDays: 2, scheduledStopCount: 2 });
    expect(t.map((x) => x.id)).toEqual(["a", "b", DESTINATION_ID]);
    expect(t[0]).toMatchObject({ kind: "stop", plannedArrival: "10:30" });
  });

  it("on an earlier day of a multi-day trip the destination is NOT added (the traveller sleeps somewhere on the way)", () => {
    const t = planDriveTargets({ remaining: [stop("a", 17.9, 79.6)], destination: dest, driveDay: 1, numDays: 3, scheduledStopCount: 4 });
    expect(t.map((x) => x.id)).toEqual(["a"]);
    expect(destinationBelongsToDrive({ driveDay: 1, numDays: 3, scheduledStopCount: 4 })).toBe(false);
  });

  it("a plain A → B trip heads to B on every day, even before the last", () => {
    expect(planDriveTargets({ remaining: [], destination: dest, driveDay: 1, numDays: 5, scheduledStopCount: 0 }).map((x) => x.id)).toEqual([DESTINATION_ID]);
  });

  it("does not send people to the same place twice when the destination is also a stop", () => {
    const t = planDriveTargets({ remaining: [stop("vizag", 17.6869, 83.2186)], destination: dest, driveDay: 1, numDays: 1, scheduledStopCount: 1 });
    expect(t.map((x) => x.id)).toEqual(["vizag"]);
  });

  it("does not navigate to a destination that was already visited as a stop today", () => {
    const t = planDriveTargets({ remaining: [], finished: [stop("vizag", 17.6869, 83.2186)], destination: dest, driveDay: 1, numDays: 1, scheduledStopCount: 1 });
    expect(t).toEqual([]);
  });

  it("ignores a missing or invalid destination instead of inventing a route", () => {
    const base = { remaining: [], driveDay: 1, numDays: 1, scheduledStopCount: 0 };
    expect(planDriveTargets({ ...base, destination: { lat: null, lng: null, name: null } })).toEqual([]);
    expect(planDriveTargets({ ...base, destination: { lat: 120, lng: 10, name: "x" } })).toEqual([]);
    expect(planDriveTargets({ ...base, destination: { lat: NaN, lng: 10, name: "x" } })).toEqual([]);
  });

  it("falls back to a readable name", () => {
    expect(planDriveTargets({ remaining: [], destination: { lat: 1, lng: 1, name: "  " }, driveDay: 1, numDays: 1, scheduledStopCount: 0 })[0].name).toBe("Destination");
  });
});
