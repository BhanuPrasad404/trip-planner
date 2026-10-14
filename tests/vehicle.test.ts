import { describe, expect, it, vi } from "vitest";
import { clearRoutingCache, osrmRouting } from "@/lib/providers/routing-osrm";
import { DEFAULT_VEHICLE, VEHICLES, VEHICLE_LABEL, avoidsMotorway, googleTravelMode, isVehicle, parseVehicle, routeFitNote } from "@/lib/vehicle";
import { googleMapsDirections } from "@/lib/maps-links";

describe("the vehicle model", () => {
  it("car, motorcycle and bus, with labels; a car by default", () => { expect(VEHICLES).toEqual(["car", "motorcycle", "bus"]); expect(VEHICLE_LABEL.motorcycle).toBe("Motorcycle"); expect(DEFAULT_VEHICLE).toBe("car"); });
  it("saved values are read safely: junk, old formats and damaged data become a car, never an error", () => {
    expect(parseVehicle("bus")).toBe("bus"); expect(parseVehicle('{"vehicle":"motorcycle"}')).toBe("motorcycle");
    for (const v of [null, undefined, "", "{", "helicopter", '{"vehicle":"tank"}', 5, [], {}]) expect(parseVehicle(v)).toBe("car");
    expect(isVehicle("car")).toBe(true); expect(isVehicle("Car")).toBe(false);
  });
  it("only a motorcycle asks to avoid motorway-class roads", () => { expect(VEHICLES.filter(avoidsMotorway)).toEqual(["motorcycle"]); });
  it("the note never overclaims", () => {
    expect(routeFitNote("car", false)).toContain("for a car");
    expect(routeFitNote("motorcycle", true)).toContain("avoids motorway-class roads"); expect(routeFitNote("motorcycle", true)).toContain("not from each road's own rules");
    expect(routeFitNote("motorcycle", false)).toContain("this is a car route"); expect(routeFitNote("motorcycle", false)).not.toContain("This route avoids");
    expect(routeFitNote("bus", true)).toContain("NOT checked"); expect(routeFitNote("bus", true)).not.toMatch(/safe|suitable/i);
  });
  it("the Google Maps hand-off uses its own two-wheeler mode for a motorcycle; a bus stays 'driving' (Google has no mode for your own bus)", () => {
    expect([googleTravelMode("car"), googleTravelMode("motorcycle"), googleTravelMode("bus")]).toEqual(["driving", "two-wheeler", "driving"]);
    expect(googleMapsDirections({ lat: 1, lng: 2 })).toContain("travelmode=driving"); expect(googleMapsDirections({ lat: 1, lng: 2 }, "motorcycle")).toContain("travelmode=two-wheeler");
  });
});

describe("the routing service adapter: avoiding motorways is best effort and never pretends", () => {
  const A = { lat: 17.385, lng: 78.4867 }, B = { lat: 17.6, lng: 78.9 };
  const okBody = { code: "Ok", routes: [{ distance: 60_000, duration: 3_000, geometry: { coordinates: [[78.4867, 17.385], [78.9, 17.6]] }, legs: [{ distance: 60_000, duration: 3_000, summary: "NH65", steps: [{ distance: 60_000, duration: 3_000, name: "NH65", ref: "NH65", maneuver: { type: "depart", location: [78.4867, 17.385], bearing_after: 80 }, intersections: [] }, { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", location: [78.9, 17.6] }, intersections: [] }] }] }] };
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const run = async (answers: (() => Response)[], avoid: boolean) => { clearRoutingCache(); const urls: string[] = []; const f = vi.fn(async (u: string) => { urls.push(u); const a = answers.shift(); if (!a) throw new Error("none"); return a(); }); const routes = await osrmRouting.directions!(A, B, { alternatives: 0, avoidMotorway: avoid }, f as unknown as typeof fetch); return { routes, urls }; };

  it("a car is never asked to exclude anything", async () => { const r = await run([() => json(okBody)], false); expect(r.urls).toHaveLength(1); expect(r.urls[0]).not.toContain("exclude"); expect(r.routes[0].avoidedMotorway).toBeUndefined(); expect(r.routes[0].source).toBe("osrm"); });
  it("a motorcycle asks for exclude=motorway and the route is marked as avoiding them", async () => { const r = await run([() => json(okBody)], true); expect(r.urls[0]).toContain("exclude=motorway"); expect(r.routes[0].avoidedMotorway).toBe(true); });
  it("if the service refuses the exclusion, it asks again plainly and the route is NOT marked", async () => {
    const r = await run([() => json({ code: "InvalidValue", message: "Exclude flag combination is not supported." }, 400), () => json(okBody)], true);
    expect(r.urls).toHaveLength(2); expect(r.urls[0]).toContain("exclude=motorway"); expect(r.urls[1]).not.toContain("exclude"); expect(r.routes[0].avoidedMotorway).toBeUndefined(); expect(r.routes[0].source).toBe("osrm");
  });
  it("if there is no road without a motorway, same: a plain route, not marked", async () => {
    const r = await run([() => json({ code: "NoRoute" }), () => json(okBody)], true); expect(r.routes[0].avoidedMotorway).toBeUndefined(); expect(r.routes[0].source).toBe("osrm");
  });
  it("if the service is down both times it is a straight-line estimate, never marked as anything", async () => {
    const r = await run([() => json({}, 500), () => json({}, 500)], true); expect(r.routes[0].source).toBe("estimate"); expect(r.routes[0].avoidedMotorway).toBeUndefined();
  });
  it("the two kinds of route are cached separately: a car's route is never served to a motorcycle", async () => {
    clearRoutingCache(); const f = vi.fn(async () => json(okBody));
    await osrmRouting.directions!(A, B, { alternatives: 0 }, f as unknown as typeof fetch);
    const m = await osrmRouting.directions!(A, B, { alternatives: 0, avoidMotorway: true }, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2); expect(m[0].avoidedMotorway).toBe(true);
  });
});
