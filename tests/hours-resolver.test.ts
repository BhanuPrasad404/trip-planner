// Slice B: one answer to "what are this place's hours on that day?", with where it came from, for every screen.
// Places are made up; schedules are written here as OpenStreetMap would write them (never real places' hours).
import { describe, expect, it } from "vitest";
import { placeRole } from "@/lib/place-intel/role";
import { resolveHours, CHECK_DATE_FRESH_DAYS, type HoursFacts } from "@/lib/server/hours-resolver";
import { hoursFor } from "@/lib/server/hours-service";
import { hoursAreKnown } from "@/lib/place-intel/hours-answer";
import type { OsmHoursRow } from "@/lib/place-intel/hours-sources";
import type { CuratedHoursAdapter } from "@/lib/place-intel/hours-adapters";

const MONDAY = "2026-11-02";
const temple = { name: "Hill Shrine", lat: 15, lng: 78, role: placeRole({ name: "Hill Shrine", category: "temple", wdType: "Q842402" }) };
const osm = (over: Partial<OsmHoursRow> = {}): OsmHoursRow => ({ ref: "osm/way/1", dataDate: "2026-10-28", openingHours: null, serviceTimes: null, hoursUrl: null, checkDate: null, website: null, ...over });
const ist = (date: string, clock: string) => Date.parse(`${date}T${clock}:00+05:30`);
const run = (facts: HoursFacts, place = temple, date = MONDAY) => resolveHours(place, facts, date);

describe("a place with no opening time of its own", () => {
  it("a city says so in plain words, with its name, and is never 'missing'", () => {
    const a = run({ osm: [osm({ openingHours: "Mo-Su 06:00-20:00" })] }, { name: "Ravipuram", lat: 15, lng: 78, role: placeRole({ name: "Ravipuram", kind: "city", population: 400_000 }) });
    expect(a).toMatchObject({ status: "not_applicable", why: "no_own_hours", day: null, schedule: null });
    expect(a.message).toBe("Ravipuram is a city, so it has no single opening time. The places to visit in it have their own hours.");
  });
  it("a town, a district and a valley too", () => {
    expect(run({}, { name: "Smalltown", lat: 15, lng: 78, role: placeRole({ name: "x", kind: "town", population: 20_000 }) }).message).toMatch(/^Smalltown is a town, so/);
    expect(run({}, { name: "Ravi District", lat: 15, lng: 78, role: placeRole({ name: "x", kind: "district" }) }).message).toMatch(/^Ravi District is a district, so/);
    expect(run({}, { name: "Green Valley", lat: 15, lng: 78, role: placeRole({ name: "x", category: "peak", wdType: "Q39816" }) }).message).toMatch(/^Green Valley is a valley, so/);
  });
});

describe("source order: the strongest readable source answers, and a weaker one never replaces it", () => {
  it("map data a mapper checked recently is 'known', with its source and that date", () => {
    const a = run({ osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" })] });
    expect(a).toMatchObject({ status: "known", schedule: "Mo-Su 06:00-20:00", source: { kind: "osm", checked: true, date: "2026-06-01" } });
    expect(a.day?.text).toBe("6:00 AM – 8:00 PM");
    expect(hoursAreKnown(a)).toBe(true);
  });
  it("map data nobody re-checked (or checked too long ago) is shown but 'unverified'", () => {
    const old = new Date(Date.parse(`${MONDAY}T00:00:00Z`) - (CHECK_DATE_FRESH_DAYS + 5) * 86_400_000).toISOString().slice(0, 10);
    for (const checkDate of [null, old]) {
      const a = run({ osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate })] });
      expect(a).toMatchObject({ status: "unverified", why: "not_verified", day: { text: "6:00 AM – 8:00 PM" } });
      expect(hoursAreKnown(a)).toBe(false);
    }
  });
  it("a check date AFTER the visit doesn't count as a check made for it… but a day's slack is allowed", () => {
    expect(run({ osm: [osm({ openingHours: "24/7", checkDate: "2026-11-03" })] }).status).toBe("known");
    expect(run({ osm: [osm({ openingHours: "24/7", checkDate: "2027-01-01" })] }).status).toBe("unverified");
  });
  it("a trip member's confirmed hours win over map data; the map's different hours are SHOWN, not dropped", () => {
    const a = run({ member: { text: "Mo-Su 05:00-21:00", confirmed: true, confirmedAt: "2026-10-30T10:00:00Z" }, osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" })] });
    expect(a).toMatchObject({ status: "known", schedule: "Mo-Su 05:00-21:00", source: { kind: "member", checked: true, date: "2026-10-30" } });
    expect(a.conflicts).toEqual([{ source: expect.objectContaining({ kind: "osm" }), schedule: "Mo-Su 06:00-20:00" }]);
    expect(a.message).toMatch(/Another source says something different/);
  });
  it("a curated, person-checked source wins over map data, and recent map data over unconfirmed hours saved on a trip", () => {
    const curated = [{ adapter: "x", name: "Test Trust page", schedule: "Mo-Su 04:30-22:00", sourceUrl: "https://example.org/hours", readOn: "2026-10-01", verifiedBy: "tester" }];
    expect(run({ curated, osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" })] }).source).toMatchObject({ kind: "curated", name: "Test Trust page", date: "2026-10-01" });
    const b = run({ member: { text: "Mo-Su 07:00-19:00", confirmed: false, confirmedAt: null }, osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" })] });
    expect(b.source?.kind).toBe("osm");
    expect(b.conflicts[0].schedule).toBe("Mo-Su 07:00-19:00");
  });
  it("two sources of the same standing that disagree: 'conflicting', both shown, neither picked", () => {
    const a = run({ osm: [osm({ ref: "osm/way/1", openingHours: "Mo-Su 06:00-20:00" }), osm({ ref: "osm/node/2", openingHours: "Mo-Su 09:00-17:00" })] });
    expect(a).toMatchObject({ status: "conflicting", why: "conflicting", day: null, schedule: null });
    expect(a.conflicts.map((c) => c.schedule).sort()).toEqual(["Mo-Su 06:00-20:00", "Mo-Su 09:00-17:00"]);
    expect(a.message).toMatch(/Sources disagree about Hill Shrine/);
  });
  it("the same hours written differently are not a conflict", () => {
    expect(run({ osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" }), osm({ ref: "osm/node/2", openingHours: "06:00-20:00" })] }).status).toBe("known");
  });
});

describe("the visit date, in India time", () => {
  it("a closed day is that date's answer, and the weekly closed day is listed", () => {
    const a = run({ osm: [osm({ openingHours: "Tu-Su 10:00-17:00", checkDate: "2026-06-01" })] });
    expect(a).toMatchObject({ status: "known", day: { intervals: [], text: "Closed on Mon, 2 Nov" } });
    expect(a.exceptions[0]).toBe("Closed on Mondays (by this schedule)");
    expect(run({ osm: [osm({ openingHours: "Tu-Su 10:00-17:00", checkDate: "2026-06-01" })] }, temple, "2026-11-03").day?.text).toBe("10:00 AM – 5:00 PM");
  });
  it("intervals are real instants in India time, whatever zone the server runs in", () => {
    const tz = process.env.TZ;
    for (const zone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
      process.env.TZ = zone;
      const a = run({ osm: [osm({ openingHours: "Mo-Su 06:00-20:00", checkDate: "2026-06-01" })] });
      expect(a.day?.intervals[0].slice(0, 2), zone).toEqual([ist(MONDAY, "06:00"), ist(MONDAY, "20:00")]);
    }
    process.env.TZ = tz;
  });
  it("hours that cross midnight are kept whole, both the night before and the night after", () => {
    const a = run({ osm: [osm({ openingHours: "Mo-Su 18:00-02:00", checkDate: "2026-06-01" })] });
    expect(a.day?.text).toBe("from the night before – 2:00 AM, 6:00 PM – 2:00 AM (next day)");
    expect(a.day?.intervals[1][1]).toBe(ist("2026-11-03", "02:00"));
  });
  it("a holiday rule: 'unable to verify' for that date (no Indian holiday calendar), shown as written", () => {
    const a = run({ osm: [osm({ openingHours: "Mo-Su 09:00-17:00; PH off", checkDate: "2026-06-01" })] });
    expect(a).toMatchObject({ status: "unverified", why: "holiday_rule", day: null, schedule: "Mo-Su 09:00-17:00; PH off" });
    expect(a.message).toMatch(/unable to verify them for Mon, 2 Nov/);
    expect(a.exceptions).toContain("The hours change on public or school holidays.");
  });
  it("an open-ended time is 'partial', and a source's note is shown as written", () => {
    expect(run({ osm: [osm({ openingHours: "Mo-Su 09:00+", checkDate: "2026-06-01" })] })).toMatchObject({ status: "partial", why: "part_unknown" });
    expect(run({ osm: [osm({ openingHours: 'Mo-Su 09:00-17:00 "last entry 16:30"', checkDate: "2026-06-01" })] }).exceptions).toContain("Note from the source: “last entry 16:30”");
  });
});

describe("when there are no usable hours, say why, and what to do", () => {
  it("unreadable text: shown as written, with why", () => {
    const a = run({ osm: [osm({ openingHours: "open most days, ask the priest" })] });
    expect(a).toMatchObject({ status: "unverified", why: "unreadable", schedule: "open most days, ask the priest", day: null });
  });
  it("only darshan / service times: 'partial', not invented into opening hours", () => {
    const a = run({ osm: [osm({ serviceTimes: "Mo-Su 05:00-12:00,16:00-21:00" })] });
    expect(a).toMatchObject({ status: "partial", why: "service_times_only", day: null, serviceTimes: "Mo-Su 05:00-12:00,16:00-21:00" });
  });
  it("open ground (a beach) with no hours: 'open access', with the usual caution", () => {
    const beach = { name: "Long Beach", lat: 15, lng: 78, role: placeRole({ name: "x", category: "beach", osmType: "natural=beach" }) };
    expect(run({ osm: [osm()] }, beach)).toMatchObject({ status: "open_access", access: expect.stringMatching(/night/) });
    // …but a beach WITH hours (a gated beach) answers with its hours
    expect(run({ osm: [osm({ openingHours: "Mo-Su 06:00-19:00", checkDate: "2026-06-01" })] }, beach).status).toBe("known");
  });
  it("nothing recorded: says where we looked (with dates), links the place's own page, and offers to add hours", () => {
    const a = run({ osm: [osm({ website: "https://example.org", hoursUrl: "https://example.org/timings" })] });
    expect(a).toMatchObject({ status: "none", why: "missing", officialLink: { url: "https://example.org/timings", label: "Page with the hours" } });
    expect(a.checked).toEqual([{ name: "OpenStreetMap (osm/way/1)", date: "2026-10-28" }]);
    expect(a.message).toBe("No opening hours are recorded for Hill Shrine on the map. Its own page may have them. If you know them, you can add them.");
    expect(a.message).not.toMatch(/aren't available/);
  });
  it("every answer for a place that can have hours carries the access caution and where it looked", () => {
    for (const f of [{}, { osm: [osm({ openingHours: "24/7" })] }]) {
      const a = run(f);
      expect(a.access).toMatch(/not a promise of entry/);
      expect(a.status === "none" ? a.checked.length >= 0 : !!a.source?.date).toBe(true);
    }
  });
});

describe("the service: catalogue rows matched by id first, then by name", () => {
  const row = (over: Record<string, unknown>) => ({ key: "osm:way/1", name: "Hill Shrine", category: "temple", lat: 15.0003, lng: 78, notable: true, heritage: false, wikidata: null, wikipedia: null, sitelinks: 0,
    hours: null, website: null, osm_id: "way/1", osm_date: "2026-10-28", wd_date: null, region_code: "AP", wd_type: null, osm_type: "amenity=place_of_worship", located_in: null, located_in_name: null,
    part_of: null, service_times: null, hours_url: null, check_date: null, ...over });
  const db = (rows: unknown[]) => ({ rpc: async () => ({ data: rows, error: null }) }) as never;
  it("the row with the place's own id answers, though another same-named row nearby has other hours", async () => {
    const a = await hoursFor(db([row({ key: "osm:way/1", hours: "Mo-Su 06:00-20:00", check_date: "2026-06-01" }), row({ key: "wd:Q9", osm_id: "way/2", wikidata: "Q9", hours: "Mo-Su 05:00-22:00", check_date: "2026-06-01" })]),
      { ...temple, ids: { wikidata: "Q9" }, date: MONDAY });
    expect(a).toMatchObject({ matchedBy: "id", status: "known", schedule: "Mo-Su 05:00-22:00" });
  });
  it("by name, a restaurant named after the shrine is not used", async () => {
    const a = await hoursFor(db([row({ name: "Hill Shrine Restaurant", hours: "Mo-Su 11:00-23:00", check_date: "2026-06-01" })]), { ...temple, date: MONDAY });
    expect(a).toMatchObject({ matchedBy: null, status: "none" });
  });
  it("no database: nothing found and nothing looked at — never 'closed'", async () => {
    const a = await hoursFor(null, { ...temple, date: MONDAY });
    expect(a).toMatchObject({ status: "none", checked: [], day: null });
  });
  it("a curated adapter's entry is used only with its page, its date and who checked it", async () => {
    const adapter: CuratedHoursAdapter = { id: "t", licence: "test", lookup: async () => ({ adapter: "t", name: "Test page", schedule: "Mo-Su 04:00-22:00", sourceUrl: "https://example.org", readOn: "2026-10-01", verifiedBy: "tester" }) };
    const unsigned: CuratedHoursAdapter = { id: "u", licence: "test", lookup: async () => ({ adapter: "u", name: "Unsigned", schedule: "24/7", sourceUrl: "https://example.org", readOn: "2026-10-01", verifiedBy: " " }) };
    const failing: CuratedHoursAdapter = { id: "f", licence: "test", lookup: async () => { throw new Error("down"); } };
    const a = await hoursFor(null, { ...temple, date: MONDAY }, [failing, unsigned, adapter]);
    expect(a).toMatchObject({ status: "known", source: { kind: "curated", name: "Test page" } });
  });
  it("a city is answered without reading anything", async () => {
    let asked = false;
    const a = await hoursFor({ rpc: async () => { asked = true; return { data: [], error: null }; } } as never, { name: "Ravipuram", lat: 15, lng: 78, role: placeRole({ name: "x", kind: "city" }), date: MONDAY });
    expect(a.status).toBe("not_applicable"); expect(asked).toBe(false);
  });
});
