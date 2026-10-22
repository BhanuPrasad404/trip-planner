import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripProgress } from "@/components/TripProgress";
import { VehicleSelector } from "@/components/VehicleSelector";
import { VEHICLE_SHAPES } from "@/components/map/puck";
import { VEHICLES } from "@/lib/vehicle";



describe("trip progress shows the real state of the day", () => {
  const stops = (...s: ("planned" | "done" | "skipped")[]) => s.map((status, i) => ({ id: `s${i}`, name: `Stop ${i + 1}`, status }));
  const h = (s: ReturnType<typeof stops>, o: { next?: string | null; km?: number | null } = {}) => renderToStaticMarkup(createElement(TripProgress, { stops: s, vehicle: "car", nextName: o.next === undefined ? "Kolanupaka" : o.next, nextKm: o.km ?? null }));
  it("says N of M, with the bar at that share, and exposes it as a progress bar", () => {
    const x = h(stops("done", "done", "planned", "planned")); expect(x).toContain("2 of 4"); expect(x).toContain("width:50%"); expect(x).toContain('role="progressbar"'); expect(x).toContain('aria-valuenow="2"'); expect(x).toContain('aria-valuemax="4"');
  });
  it("a skipped stop is not counted against you, and is said", () => { const x = h(stops("done", "skipped", "planned")); expect(x).toContain("1 of 2"); expect(x).toContain("1 skipped"); expect(x).toContain("width:50%"); });
  it("nothing done is 0%, everything done is 100% and says so", () => {
    expect(h(stops("planned", "planned"))).toContain("width:0%"); const all = h(stops("done", "done"), { next: null }); expect(all).toContain("width:100%"); expect(all).toContain("every stop for today");
  });
  it("shows the next stop and its real distance only when it has one", () => { expect(h(stops("planned"), { km: 22.4 })).toContain("22 km"); expect(h(stops("planned"), { km: 4.26 })).toContain("4.3 km"); expect(h(stops("planned"))).not.toMatch(/\d+ km/); });
  it("it moves only through a transition on a real change, and not at all for reduced motion (no looping animation)", () => {
    const x = h(stops("done", "planned")); expect(x).toContain("transition-[width]"); expect(x).toContain("motion-reduce:transition-none"); expect(x).not.toContain("animate-");
  });
  it("each stop is named for screen readers, with its state", () => { const x = h(stops("done", "skipped", "planned")); expect(x).toContain("Stop 1: done"); expect(x).toContain("Stop 2: skipped"); expect(x).toContain("Stop 3: still to do"); });
  it("nothing for a day with no stops", () => { expect(h([])).toBe(""); });
  it("shows YOUR vehicle on the bar", () => { for (const v of VEHICLES) expect(renderToStaticMarkup(createElement(TripProgress, { stops: stops("done"), vehicle: v, nextName: null, nextKm: null }))).toContain("<svg"); });
});

describe("vehicle selector and marker", () => {
  it("three real choices, each a big tap target, with the honest hint for the chosen one", () => {
    const h = renderToStaticMarkup(createElement(VehicleSelector, { value: "bus", onChange: () => {} }));
    for (const t of ["Car", "Motorcycle", "Bus"]) expect(h).toContain(t); expect(h).toContain('role="radiogroup"'); expect(h).toContain("min-h-14"); expect(h).toContain('aria-checked="true"'); expect(h).toContain("Bus restrictions, size limits and stops aren&#x27;t checked");
  });
  it("the compact form is icons with names for screen readers", () => { const h = renderToStaticMarkup(createElement(VehicleSelector, { value: "car", onChange: () => {}, compact: true })); expect(h).toContain("h-11 w-12"); expect(h).toContain('class="sr-only">Motorcycle'); });
  it("the map marker has a different silhouette for each vehicle, built from safe data only", () => {
    const sig = (v: (typeof VEHICLES)[number]) => JSON.stringify(VEHICLE_SHAPES[v]);
    expect(new Set(VEHICLES.map(sig)).size).toBe(3);
    for (const v of VEHICLES) for (const { part, shape } of VEHICLE_SHAPES[v]) { expect(["body", "detail"]).toContain(part); expect(["rect", "circle", "path"]).toContain(shape.tag); for (const val of Object.values(shape.attrs)) expect(val).toMatch(/^[-0-9a-zA-Z. ]+$/); }
    expect(VEHICLE_SHAPES.bus.length).toBeGreaterThan(VEHICLE_SHAPES.motorcycle.length); // a bus is longer than a motorcycle
  });
});
