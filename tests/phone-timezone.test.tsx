// A phone set to another time zone (Tokyo, New York) near midnight INDIA time: every "today", "now" and clock the app shows is India
// time. Real components and functions; the phone's own time zone is really switched (process.env.TZ).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { NewTripForm } from "@/components/NewTripForm";
import { restOfDayText } from "@/components/map/NavigationOverlay";

const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60_000;
const TZ = process.env.TZ;
afterEach(() => { process.env.TZ = TZ; vi.useRealTimers(); });
const at = (tz: string, ms: number) => { process.env.TZ = tz; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(ms); };

describe("near midnight India time, a phone on another time zone", () => {
  it("new trip: the earliest date allowed is India's today (Tokyo is already on the 23rd, New York still on the 22nd)", () => {
    for (const [tz, ms, today] of [["Asia/Tokyo", ist(22, 23, 45), "2026-10-22"], ["America/New_York", ist(23, 0, 30), "2026-10-23"], ["Asia/Kolkata", ist(23, 0, 30), "2026-10-23"]] as const) {
      at(tz, ms);
      expect(renderToStaticMarkup(createElement(NewTripForm))).toContain(`min="${today}"`);
    }
  });
  it("the map's 'done about' time is India time, and says (tomorrow) by India's calendar", () => {
    const j = { name: "Vizag", remainingKm: 40, remainingMin: 70, etaMs: ist(23, 0, 40), stops: 2 };
    for (const tz of ["Asia/Tokyo", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      expect(restOfDayText(j, ist(22, 23, 30))).toMatch(/done about 12:40 am \(tomorrow\) \(with stops\)$/i);
    }
  });
});

describe("guard: no screen or client code reads 'today' or 'now' from the phone's own clock", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : []; });
  it("no getTimezoneOffset, no local getHours/getMinutes/getDate on a moment, no time or date shown without India's time zone", () => {
    const bad: string[] = [];
    for (const f of [...files("components"), ...files("lib/client"), ...files("app")]) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/getTimezoneOffset|\.getHours\(\)|\.getMinutes\(\)/.test(line)) bad.push(`${f}:${i + 1}`);
        if (/toLocale(Time|)String\(/.test(line) && /hour|minute/.test(line) && !/timeZone/.test(line)) bad.push(`${f}:${i + 1}`);
        if (/new Date\([^)]*\)\.toLocaleDateString\(/.test(line) && !/timeZone/.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
