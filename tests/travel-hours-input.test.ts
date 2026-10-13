import { describe, expect, it } from "vitest";
import { normalizeHoursInput } from "@/lib/travel/hours-input";
import { openStatus } from "@/lib/intel/hours";

const ok = (s: string) => { const r = normalizeHoursInput(s); if (!r.ok) throw new Error(r.reason); return r.hours; };

describe("normalizeHoursInput: people type hours loosely; we read them strictly or refuse", () => {
  it("empty means 'no hours entered' (not an error)", () => { expect(normalizeHoursInput("   ")).toEqual({ ok: true, hours: null }); });
  it("plain times apply every day", () => {
    expect(ok("09:00-18:00")).toBe("Mo-Su 09:00-18:00");
    expect(ok("9:30 - 17:45")).toBe("Mo-Su 09:30-17:45");
    expect(ok("9 to 11")).toBe("Mo-Su 09:00-11:00");
    expect(ok("20:00-02:00")).toBe("Mo-Su 20:00-02:00"); // a real overnight opening is fine: the start is after noon
  });
  it("am/pm is understood", () => {
    expect(ok("9am-6pm")).toBe("Mo-Su 09:00-18:00");
    expect(ok("9:30 am - 5:15 pm")).toBe("Mo-Su 09:30-17:15");
    expect(ok("12am-12pm")).toBe("Mo-Su 00:00-12:00");
    expect(ok("12pm-11pm")).toBe("Mo-Su 12:00-23:00");
  });
  it("days are kept, with any capitalisation", () => {
    expect(ok("mo-sa 9am-5pm")).toBe("Mo-Sa 09:00-17:00");
    expect(ok("Su 10:00-14:00")).toBe("Su 10:00-14:00");
  });
  it("two periods in a day", () => { expect(ok("09:00-13:00, 15:00-19:00")).toBe("Mo-Su 09:00-13:00,15:00-19:00"); });
  it("'open 24 hours' and friends become 24/7", () => { for (const t of ["24/7", "24 hours", "Open 24 hours", "all day", "always open"]) expect(ok(t), t).toBe("24/7"); });
  it("'closed' is refused with a helpful reason (we need the hours when it is open)", () => {
    expect(normalizeHoursInput("closed")).toEqual({ ok: false, reason: "Enter the hours when it IS open." });
  });
  it("ambiguous 'short' times are not guessed: '9-6' could be 9am-6pm or 9am-6am, so it asks", () => {
    for (const amb of ["9-6", "10 to 5", "9:00-6:00"]) {
      const r = normalizeHoursInput(amb);
      expect(r.ok, amb).toBe(false);
      if (!r.ok) { expect(r.reason).toContain("Add am or pm"); expect(r.reason).toContain("09:00-18:00"); }
    }
  });
  it("anything unreadable is refused with an example, never guessed", () => {
    for (const bad of ["around 6", "dawn to dusk", "25:00-26:00", "13pm-2pm", "9-", "abc", "09:00-18:70"]) {
      const r = normalizeHoursInput(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toContain("09:00-18:00");
    }
  });
  it("what it produces is exactly what the engine's reader understands", () => {
    const hours = ok("9am-6pm")!;
    const noon = Date.UTC(2026, 9, 14, 6, 30); // 12:00 IST
    const night = Date.UTC(2026, 9, 14, 17, 30); // 23:00 IST
    expect(openStatus(hours, noon, 330).state).toBe("open");
    expect(openStatus(hours, night, 330).state).toBe("closed");
  });
});
