import { describe, expect, it } from "vitest";
import { MIN_FIRST_DAY_MIN, startOptions } from "@/lib/result/start-options";

const ist = (date: string, hh: number, mm = 0) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh, mm) - 330 * 60_000;
const base = { usualStartMin: 510, dayEndMin: 1200, sunsetMin: 1065, nightDriving: false }; // 8:30 AM start, 8 PM end, sunset 5:45 PM

describe("when to start", () => {
  it("early morning: today at the usual time is best, tomorrow is the alternative", () => {
    const o = startOptions({ ...base, nowMs: ist("2026-10-26", 7, 0) });
    expect(o.map((x) => x.id)).toEqual(["today_usual", "tomorrow"]);
    expect(o[0]).toMatchObject({ best: true, startISO: "2026-10-26", startTime: null, label: "Start today at 8:30 AM" });
  });
  it("late morning: start soon, rounded to the next quarter hour after getting ready, and it is still the best", () => {
    const o = startOptions({ ...base, nowMs: ist("2026-10-26", 10, 7) });
    expect(o[0]).toMatchObject({ id: "today_now", startTime: "10:30", best: true, label: "Start today at 10:30 AM" });
    expect(o[0].detail).toMatch(/daylight left \(sunset about 5:45 PM\)/);
    expect(o[1]).toMatchObject({ id: "tomorrow", best: false });
  });
  it("mid-afternoon: today is possible but short, so tomorrow is the best", () => {
    const o = startOptions({ ...base, nowMs: ist("2026-10-26", 14, 0) });
    expect(o[0]).toMatchObject({ id: "today_now", startTime: "14:15", best: false });
    expect(o[0].detail).toMatch(/day 1 will be short/);
    expect(o.find((x) => x.best)?.id).toBe("tomorrow");
  });
  it("at night with no night driving: only tomorrow, and it says why in plain words", () => {
    const o = startOptions({ ...base, nowMs: ist("2026-10-26", 21, 30) });
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ id: "tomorrow", best: true, startISO: "2026-10-27", label: "Start tomorrow at 8:30 AM" });
    expect(o[0].detail).toMatch(/It's 9:30 PM/); expect(o[0].detail).toMatch(/rather not drive at night/);
  });
  it("evening: with night driving allowed there is still time today; without it there is not", () => {
    const at4 = ist("2026-10-26", 16, 0);
    expect(startOptions({ ...base, nowMs: at4 }).map((x) => x.id)).toEqual(["tomorrow"]);
    const night = startOptions({ ...base, nightDriving: true, nowMs: at4 });
    expect(night[0]).toMatchObject({ id: "today_now", startTime: "16:15" });
    expect(night[0].detail).toMatch(/until the day's end \(8:00 PM\)/);
  });
  it("never offers a first day shorter than the minimum", () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 20, 40]) for (const nightDriving of [false, true]) {
      const o = startOptions({ ...base, nightDriving, nowMs: ist("2026-10-26", h, m) });
      expect(o.filter((x) => x.best)).toHaveLength(1);
      expect(o.some((x) => x.id === "tomorrow")).toBe(true);
      for (const x of o) if (x.id === "today_now") {
        const [hh, mm] = x.startTime!.split(":").map(Number);
        const end = nightDriving ? 1200 : 1065;
        expect(end - (hh * 60 + mm)).toBeGreaterThanOrEqual(MIN_FIRST_DAY_MIN);
      }
    }
  });
  it("works without a known sunset (uses the day's end)", () => {
    expect(startOptions({ ...base, sunsetMin: null, nowMs: ist("2026-10-26", 15, 0) })[0].id).toBe("today_now");
  });
});
