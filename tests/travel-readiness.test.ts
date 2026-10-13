import { describe, expect, it } from "vitest";
import { checkReadiness, type ReadinessInput } from "@/lib/travel/readiness";

const place = (o: Partial<ReadinessInput["places"][number]> = {}) => ({ id: "p1", name: "Bhongir Fort", day_number: 1, sequence_order: 1, arrival_time: "10:00", drive_minutes: 50, hours: null, ...o });
const input = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  action: "plan", todayISO: "2026-10-12",
  trip: { start_date: "2026-10-14", num_days: 3, start_lat: 17.38, start_lng: 78.48, dest_lat: 17.5, dest_lng: 78.9 },
  places: [place()], device: null, departure: null, ...o,
});
const ids = (r: ReturnType<typeof checkReadiness>) => r.items.map((i) => i.id);
const noDates = { start_date: null, num_days: 5, start_lat: 17.38, start_lng: 78.48 };

describe("a trip without dates (acceptance: can be saved, with the right warnings)", () => {
  it("can be saved: nothing blocks", () => {
    const r = checkReadiness(input({ action: "save", trip: noDates }));
    expect(r.canProceed).toBe(true);
    expect(ids(r)).toContain("no-dates");
  });
  it("starting navigation produces the clear prompt, naming what is unavailable, without forcing anything", () => {
    const r = checkReadiness(input({ action: "start-navigation", trip: noDates }));
    const item = r.items.find((i) => i.id === "no-dates")!;
    expect(item.message).toBe("Your trip dates aren't set yet. Set them to check destination opening hours, weather forecasts, estimated arrival times and travel conditions.");
    expect(item.next).toEqual({ step: "set-dates", label: "Set trip dates" });
    expect(item.affects).toEqual(expect.arrayContaining(["season_scores", "weather", "opening_hours"]));
    expect(r.canProceed).toBe(true);                                  // "continue with limited checks" is allowed
    expect(r.unavailable).toEqual(expect.arrayContaining(["season_scores", "weather", "opening_hours", "day_labels"]));
    expect(r.headline).toBe("Ready, with 1 limit");
  });
  it("an impossible date counts as no date, not as a real one", () => {
    expect(ids(checkReadiness(input({ trip: { ...noDates, start_date: "2026-02-31" } })))).toContain("no-dates");
  });
});

describe("the departure check needs a date, a time and driving times — and says which", () => {
  it("with nothing chosen: blocked by the missing date and time", () => {
    const r = checkReadiness(input({ action: "check-departure", trip: noDates, departure: { date: null, time: null } }));
    expect(r.canProceed).toBe(false);
    expect(r.items.filter((i) => i.severity === "blocker").map((i) => i.id).sort()).toEqual(["no-departure-date", "no-departure-time"]);
    expect(r.headline).toBe("Needs 2 things first");
  });
  it("a date typed into the check is enough even if the trip has none", () => {
    const r = checkReadiness(input({ action: "check-departure", trip: noDates, departure: { date: "2026-10-14", time: "21:00" } }));
    expect(r.canProceed).toBe(true); expect(ids(r)).not.toContain("no-departure-date");
  });
  it("the trip's own date is used when none is typed", () => {
    expect(ids(checkReadiness(input({ action: "check-departure", departure: { date: null, time: "21:00" } })))).not.toContain("no-departure-date");
  });
  it("stops without driving times block it, and point to Plan my trip", () => {
    const r = checkReadiness(input({ action: "check-departure", departure: { date: null, time: "21:00" }, places: [place({ drive_minutes: null })] }));
    const item = r.items.find((i) => i.id === "no-drive-times")!;
    expect(item.severity).toBe("blocker"); expect(item.next.step).toBe("plan-trip"); expect(r.canProceed).toBe(false);
  });
  it("always discloses the transport assumption instead of silently defaulting", () => {
    expect(ids(checkReadiness(input({ action: "check-departure", departure: { date: null, time: "21:00" } })))).toContain("default-transport");
  });
});

describe("start point and location", () => {
  const noStart = { ...noDates, start_date: "2026-10-14", start_lat: null, start_lng: null };
  it("planning needs a start point", () => {
    const r = checkReadiness(input({ action: "plan", trip: noStart }));
    expect(r.items.find((i) => i.id === "no-start-point")!.blocksAction).toBe(true); expect(r.canProceed).toBe(false);
  });
  it("navigation can start from the device when it has a good position", () => {
    const ok = checkReadiness(input({ action: "start-navigation", trip: noStart, device: { permission: "granted", hasFix: true, accurate: true } }));
    expect(ok.canProceed).toBe(true);
    expect(ok.items.find((i) => i.id === "no-start-point")!.message).toContain("where you are now");
    const bad = checkReadiness(input({ action: "start-navigation", trip: noStart, device: { permission: "denied", hasFix: false, accurate: false } }));
    expect(bad.canProceed).toBe(false);
  });
  it("blocked location gives a manual way forward, and does not block", () => {
    const r = checkReadiness(input({ action: "find-nearby", device: { permission: "denied", hasFix: false, accurate: false } }));
    const item = r.items.find((i) => i.id === "location-off")!;
    expect(item.next.step).toBe("choose-place"); expect(item.message).toContain("choose a place yourself"); expect(r.canProceed).toBe(true);
  });
  it("a rough position is only an informational note", () => {
    const r = checkReadiness(input({ action: "start-navigation", device: { permission: "granted", hasFix: true, accurate: false } }));
    expect(r.items.find((i) => i.id === "location-rough")!.severity).toBe("info");
  });
  it("nothing to go to blocks planning and navigation", () => {
    const r = checkReadiness(input({ action: "start-navigation", places: [], trip: { ...noDates, start_date: "2026-10-14" } }));
    expect(r.items.find((i) => i.id === "nothing-to-go-to")!.blocksAction).toBe(true);
  });
  it("a destination alone is enough to navigate to", () => {
    expect(ids(checkReadiness(input({ action: "start-navigation", places: [] })))).not.toContain("nothing-to-go-to");
  });
});

describe("opening hours: information only, never a blocker", () => {
  it("counts the stops without hours and says what that means", () => {
    const r = checkReadiness(input({ action: "check-departure", departure: { date: null, time: "09:00" }, places: [place({ id: "a" }), place({ id: "b", hours: "Mo-Su 09:00-18:00" }), place({ id: "c" })] }));
    const item = r.items.find((i) => i.id === "hours-unverified")!;
    expect(item.severity).toBe("info"); expect(item.message).toContain("2 of 3 stops have no opening hours"); expect(item.next.step).toBe("enter-hours");
  });
  it("when every stop has hours there is no note", () => {
    expect(ids(checkReadiness(input({ places: [place({ hours: "24/7" })] })))).not.toContain("hours-unverified");
  });
});

describe("conflicts and consistency", () => {
  it("a later stop timed earlier than the one before it is reported with its day", () => {
    const r = checkReadiness(input({ places: [place({ id: "a", sequence_order: 1, arrival_time: "14:00" }), place({ id: "b", sequence_order: 2, arrival_time: "11:00" })] }));
    expect(r.items.find((i) => i.id === "conflicting-times")!.message).toContain("Day 1");
  });
  it("stops on days after the trip ends are reported", () => {
    const r = checkReadiness(input({ places: [place({ day_number: 5 })] }));
    expect(r.items.find((i) => i.id === "stops-beyond-trip")!.message).toContain("1 stop is on days after the trip ends");
  });
  it("a past date is noted for planning, but not for starting a drive (the drive gate handles that)", () => {
    const past = { ...noDates, start_date: "2026-09-01" };
    expect(ids(checkReadiness(input({ action: "plan", trip: past })))).toContain("dates-in-past");
    expect(ids(checkReadiness(input({ action: "start-navigation", trip: past })))).not.toContain("dates-in-past");
  });
});

describe("shape of the result", () => {
  it("a complete trip is simply ready", () => {
    const r = checkReadiness(input({ action: "start-navigation", places: [place({ hours: "24/7" })] }));
    expect(r).toMatchObject({ canProceed: true, headline: "Ready", counts: { blocker: 0, important: 0, info: 0 } });
  });
  it("blockers come first; every item says why it matters and what to do next", () => {
    const r = checkReadiness(input({ action: "check-departure", trip: noDates, departure: { date: null, time: null }, places: [place({ drive_minutes: null })] }));
    const ranks = r.items.map((i) => ({ blocker: 0, important: 1, info: 2 })[i.severity]);
    expect([...ranks].sort()).toEqual(ranks);
    for (const i of r.items) { expect(i.why.length).toBeGreaterThan(10); expect(i.message.length).toBeGreaterThan(10); expect(i.affects.length).toBeGreaterThan(0); }
  });
  it("is deterministic", () => {
    const a = checkReadiness(input({ trip: noDates })), b = checkReadiness(input({ trip: noDates }));
    expect(a).toEqual(b);
  });
});
