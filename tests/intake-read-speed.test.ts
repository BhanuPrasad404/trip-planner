// The instant reader must be instant the FIRST time too (its own file, so nothing has warmed it up). Before the Phase 3 fix the first
// reading of each sample took up to 2-3 s (a Unicode letter class compiled once per word); all 18 samples took about 7 s.
import { describe, expect, it } from "vitest";
import { readTrip } from "@/lib/intake/read";
import { TRIP_TEXTS } from "./fixtures/trip-texts";

describe("instant reader speed", () => {
  it("reads all 18 sample messages, cold, in well under 3 seconds", () => {
    const t = performance.now();
    for (const s of TRIP_TEXTS) readTrip(s.text, { todayMonth: 10 });
    expect(performance.now() - t).toBeLessThan(3000);
  });
  it("a second reading of a message takes a few milliseconds", () => {
    const s = TRIP_TEXTS[0].text;
    readTrip(s, { todayMonth: 10 });
    const t = performance.now();
    readTrip(s, { todayMonth: 10 });
    expect(performance.now() - t).toBeLessThan(50);
  });
});
