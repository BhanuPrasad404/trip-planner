import { describe, expect, it } from "vitest";
import { NAME_MAX_AGE_MS, accuracyOf, problemFromCode, problemMessage, reusableName, round3 } from "@/lib/location/start-location";

describe("'Use my current location' — words for every state", () => {
  it("every problem has a title and tells the traveller they can type instead", () => {
    for (const p of ["denied", "unavailable", "timeout", "unsupported", "insecure"] as const) {
      const m = problemMessage(p);
      expect(m.title.length).toBeGreaterThan(5);
      expect(m.detail.join(" ")).toMatch(/type your area/i);
    }
  });
  it("blocked: explains how to allow it on Android and on iPhone", () => {
    const d = problemMessage("denied").detail.join(" ");
    expect(d).toMatch(/Android/);
    expect(d).toMatch(/iPhone/);
  });
  it("browser error codes map to the right problem", () => {
    expect(problemFromCode(1)).toBe("denied");
    expect(problemFromCode(2)).toBe("unavailable");
    expect(problemFromCode(3)).toBe("timeout");
  });
  it("accuracy in words: precise, approximate, rough (with what to do), unknown", () => {
    expect(accuracyOf(38)).toEqual({ level: "precise", text: "Accurate to about 40 m" });
    expect(accuracyOf(600).level).toBe("approximate");
    expect(accuracyOf(1200).text).toMatch(/1\.2 km/);
    const rough = accuracyOf(5000);
    expect(rough.level).toBe("rough");
    expect(rough.text).toMatch(/network position/);
    expect(accuracyOf(null).level).toBe("unknown");
    expect(accuracyOf(0).level).toBe("unknown");
  });
});

describe("reusing the last name (the daily limit is not wasted)", () => {
  const prev = { lat: 17.448, lng: 78.391, name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana", at: 1_000_000 };
  it("within 1 km: reuse", () => {
    expect(reusableName(prev, { lat: 17.452, lng: 78.395 }, 2_000_000)).toBe(prev); // ~0.6 km
  });
  it("moved more than 1 km: look it up again", () => {
    expect(reusableName(prev, { lat: 17.46, lng: 78.391 }, 2_000_000)).toBeNull(); // ~1.3 km
  });
  it("too old, from the future, or damaged: look it up again", () => {
    expect(reusableName(prev, prev, prev.at + NAME_MAX_AGE_MS + 1)).toBeNull();
    expect(reusableName(prev, prev, prev.at - 1)).toBeNull();
    expect(reusableName({ ...prev, name: "" }, prev, prev.at + 1)).toBeNull();
    expect(reusableName({ ...prev, lat: Number.NaN }, prev, prev.at + 1)).toBeNull();
    expect(reusableName(null, prev, 1)).toBeNull();
  });
  it("positions are rounded to ~100 m before they leave the phone", () => {
    expect(round3(17.448312)).toBe(17.448);
    expect(round3(78.39159)).toBe(78.392);
  });
});
