import { describe, expect, it } from "vitest";
import { readTrip } from "@/lib/intake/read";
import { asciiDigits } from "@/lib/intake/lexicon";
import { TRIP_TEXTS } from "./fixtures/trip-texts";

const OCT = { todayMonth: 10 };
const value = (r: ReturnType<typeof readTrip>, k: string) => (r.answers as Record<string, { value: unknown } | undefined>)[k]?.value;

describe("instant reader (no AI) — every sample, every language", () => {
  // The start is checked as "the words before 'from'": they are matched to a real town in tests/intake-places.test.ts.
  const START_WORDS: Record<string, string> = {
    "te-rom-1": "Hyderabad", "te-script": "హైదరాబాద్", "te-rom-3": "Vizag", hinglish: "Bangalore", "hi-script": "दिल्ली", "hi-mix": "मुंबई", "en-1": "Pune", "en-2": "Chennai", "en-3": "Kochi",
    "ta-script": "சென்னை", "ta-rom": "Madurai", "kn-script": "ಬೆಂಗಳೂರ", "kn-rom": "Mysore", "mr-rom": "Mumbai",
  };
  for (const s of TRIP_TEXTS) {
    it(`${s.lang}: ${s.text.slice(0, 50)}…`, () => {
      const r = readTrip(s.text, OCT);
      for (const k of ["days", "month", "group", "groupSize", "mode", "nightDriving", "pace", "endMode"] as const) if (s.want[k] !== undefined) expect(value(r, k), k).toEqual(s.want[k]);
      if (s.want.interests) expect([...(value(r, "interests") as string[])].sort()).toEqual([...s.want.interests].sort());
      if (START_WORDS[s.id]) expect(r.startCandidates).toContain(START_WORDS[s.id]);
    });
  }
  it("Marathi 'पुण्याहून' (from Pune) also offers पुणे, undoing the bent ending", () => {
    expect(readTrip("पुण्याहून 2 दिवस", OCT).startCandidates).toContain("पुणे");
  });
  it("every answer carries the traveller's own words", () => {
    const r = readTrip("4 rojulu Hyderabad nundi, friends tho beaches", OCT);
    expect(r.answers.days).toEqual({ value: 4, source: "said", evidence: "4 rojulu" });
    expect(r.answers.group?.evidence).toBe("friends");
  });
});

describe("instant reader — it does not over-read", () => {
  it("'#weekendvibes' is not a weekend trip; '3 din' is not 3 people; 'रात में' is not May", () => {
    expect(value(readTrip("📍 Gandikota #weekendvibes", OCT), "days")).toBeUndefined();
    expect(value(readTrip("Bangalore se 3 din ka trip", OCT), "groupSize")).toBeUndefined();
    expect(value(readTrip("रात में ड्राइव नहीं", OCT), "month")).toBeUndefined();
  });
  it("'next month 6 days' is 6 days in NEXT month (the AI got this wrong in every model we tried)", () => {
    const r = readTrip("next month 6 days Kerala trip", OCT);
    expect(value(r, "days")).toBe(6);
    expect(value(r, "month")).toBe(11);
    expect(value(readTrip("next month", { todayMonth: 12 }), "month")).toBe(1); // December → January
  });
  it("'3 nights' alone is a 4-day trip; '3N/4D' is 4 days; '3 nights' is never 'night driving'", () => {
    expect(value(readTrip("3 nights in Coorg", OCT), "days")).toBe(4);
    expect(value(readTrip("Goa 3N/4D package", OCT), "days")).toBe(4);
    expect(value(readTrip("3 nights, no hotel booked", OCT), "nightDriving")).toBeUndefined();
  });
  it("native digits and number words: '౪ రోజులు', 'चार दिन', 'naalugu rojulu', 'four days'", () => {
    expect(asciiDigits("౪ ४ ௪ ೪")).toBe("4 4 4 4");
    for (const t of ["౪ రోజులు", "चार दिन", "naalugu rojulu", "four days", "naangu naatkal", "ನಾಲ್ಕು ದಿನ", "4-day"]) expect(value(readTrip(t, OCT), "days"), t).toBe(4);
  });
  it("'car' is not found inside 'card'; 'May' only as a month", () => {
    expect(value(readTrip("pay by card", OCT), "mode")).toBeUndefined();
    expect(value(readTrip("we may go", OCT), "month")).toBeUndefined();
    expect(value(readTrip("in May", OCT), "month")).toBe(5);
  });
  it("most driving per day, only when it is about driving", () => {
    expect(value(readTrip("not more than 5 hours driving a day", OCT), "maxDriveHours")).toBe(5);
    expect(value(readTrip("5 gantalu drive chalu", OCT), "maxDriveHours")).toBe(5);
    expect(value(readTrip("trek of 5 hours", OCT), "maxDriveHours")).toBeUndefined();
  });
  it("place pieces: names kept, grammar words and the start dropped", () => {
    expect(readTrip("Vizag nundi Araku, Lambasingi, Borra caves - 2 rojulu", OCT).places.map((p) => p.said)).toEqual(["Araku", "Lambasingi", "Borra caves"]);
    expect(readTrip("weekend trip from Pune, Lonavala is a must", OCT).places).toEqual([expect.objectContaining({ said: "Lonavala", must: true })]);
    const reel = readTrip("📍 Gandikota – Grand Canyon of India\n📍 Belum Caves\n#gandikota #andhratourism #explorepage", OCT).places.map((p) => p.said);
    expect(reel).toEqual(expect.arrayContaining(["Gandikota", "Belum Caves"]));
    expect(reel.filter((p) => /tourism|explore/i.test(p))).toEqual([]); // generic hashtags are not places
  });
  it("tells which scripts were used", () => {
    expect(readTrip("హైదరాబాద్ నుండి 4 days", OCT).scripts).toEqual(["Telugu", "Latin"]);
  });
  it("a very long paste is cut, never slow", () => {
    const t0 = performance.now();
    readTrip("4 days from Hyderabad, friends. ".repeat(500), OCT);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
