import { describe, expect, it } from "vitest";
import { delayText, formatClock, formatDistance, freshness, lastSeenText, shouldPublish, summarizeDrive } from "@/lib/live";

const T0 = 1_000_000_000_000;
const here = { lat: 17.0, lng: 80.0 };

describe("shouldPublish", () => {
  it("publishes the first fix", () => expect(shouldPublish(null, { ...here, at: T0 })).toBe(true));
  it("ignores GPS jitter and fast repeats", () => {
    expect(shouldPublish({ ...here, at: T0 }, { lat: 17.00002, lng: 80.0, at: T0 + 30_000 })).toBe(false); // ~2 m in 30 s
    expect(shouldPublish({ ...here, at: T0 }, { lat: 17.01, lng: 80.0, at: T0 + 3_000 })).toBe(false); // moved, but only 3 s later
  });
  it("publishes after real movement", () => expect(shouldPublish({ ...here, at: T0 }, { lat: 17.001, lng: 80.0, at: T0 + 10_000 })).toBe(true)); // ~111 m in 10 s
  it("sends a heartbeat every 60 s even when standing still", () => {
    expect(shouldPublish({ ...here, at: T0 }, { ...here, at: T0 + 61_000 })).toBe(true);
    expect(shouldPublish({ ...here, at: T0 }, { ...here, at: T0 + 59_000 })).toBe(false);
  });
});

describe("freshness / lastSeenText", () => {
  const ago = (ms: number) => new Date(T0 - ms).toISOString();
  it("classifies live, recent and stale", () => {
    expect(freshness(ago(30_000), T0)).toBe("live");
    expect(freshness(ago(5 * 60_000), T0)).toBe("recent");
    expect(freshness(ago(30 * 60_000), T0)).toBe("stale");
  });
  it("speaks in human units", () => {
    expect(lastSeenText(ago(10_000), T0)).toBe("just now");
    expect(lastSeenText(ago(7 * 60_000), T0)).toBe("7 min ago");
    expect(lastSeenText(ago(3 * 3_600_000), T0)).toBe("3 h ago");
  });
});

describe("formatting", () => {
  it("formats distance", () => {
    expect(formatDistance(0.45)).toBe("450 m");
    expect(formatDistance(0.004)).toBe("10 m");
    expect(formatDistance(4.26)).toBe("4.3 km");
    expect(formatDistance(86.4)).toBe("86 km");
  });
  it("formats clock times, including past midnight", () => {
    expect(formatClock(14 * 60 + 32)).toBe("14:32");
    expect(formatClock(24 * 60 + 20)).toBe("00:20 (+1 day)");
  });
});

describe("summarizeDrive", () => {
  const stops = [
    { id: "a", name: "Fort", plannedArrival: "10:00" },
    { id: "b", name: "Falls", plannedArrival: "13:00" },
  ];
  const legs = [{ km: 20, minutes: 30 }, { km: 40, minutes: 50 }];

  it("accumulates distance and time, adds the stay at earlier stops, and compares with the plan", () => {
    const s = summarizeDrive(legs, stops, 9 * 60 + 40, true, (id) => (id === "a" ? 90 : 0))!;
    expect(s.next).toMatchObject({ id: "a", km: 20, minutes: 30, eta: "10:10", delayMin: 10 }); // 9:40 + 30 min vs planned 10:00
    expect(s.stops[1]).toMatchObject({ id: "b", km: 60, minutes: 170, eta: "12:30" }); // 10:10 + 90 min stay + 50 min drive
    expect(s.stops[1].delayMin).toBe(-30); // planned 13:00
    expect(s.totalKm).toBe(60);
    expect(s.finishEta).toBe("12:30");
  });

  it("does not compare with the plan when the day is not today", () => {
    expect(summarizeDrive(legs, stops, 600, false)!.next.delayMin).toBeNull();
  });

  it("returns null with nothing to drive to, and tolerates fewer legs than stops", () => {
    expect(summarizeDrive([], stops, 600, true)).toBeNull();
    expect(summarizeDrive(legs.slice(0, 1), stops, 600, true)!.stops).toHaveLength(1);
  });
});

describe("delayText", () => {
  it("treats ±5 min as on time and words the rest", () => {
    expect(delayText(null)).toBeNull();
    expect(delayText(3)).toEqual({ text: "On time", tone: "ok" });
    expect(delayText(-4)).toEqual({ text: "On time", tone: "ok" });
    expect(delayText(25)).toEqual({ text: "25 min behind plan", tone: "late" });
    expect(delayText(-12)).toEqual({ text: "12 min ahead of plan", tone: "early" });
  });
});
