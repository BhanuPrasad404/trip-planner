// Slice B: which map objects become places we can find hours for, and which hours tags survive. Measured on the Phase 0 shapes
// (tests/fixtures/place-intel/tagsets.json): shapes, not real coverage.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toRecord } from "@/lib/poi/taxonomy";
import { admission, summarizeAdmission, type TagsetFixture } from "@/lib/place-intel/metrics";
import { featureToRow, checkDate } from "@/lib/catalog/osm";
import { rowOk } from "@/lib/catalog/types";

const tagsets = (JSON.parse(readFileSync(new URL("./fixtures/place-intel/tagsets.json", import.meta.url), "utf8")) as { tagsets: TagsetFixture[] }).tagsets;
const rec = (tags: Record<string, string>) => { const r = toRecord({ id: "node/1", lat: 17, lng: 78, tags }, "osm", "2026-01-01T00:00:00Z"); return r ? { kind: r.kind, tags: r.tags } : null; };

describe("the map-data store", () => {
  const rows = admission(tagsets, rec);
  const sum = summarizeAdmission(rows, tagsets);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  it("keeps every named temple shape somebody found notable or that carries hours data", () => {
    const temples = ["t02", "t03", "t04", "t05", "t06", "t07", "t08"];
    for (const id of temples) expect(byId[id].admitted, `${id} ${byId[id].label}`).toBe(true);
    const t = sum.byCategory.find((c) => c.category === "temple")!;
    console.log(`[admission] all named shapes kept: ${sum.admitted.pct}% (was 45%); temple shapes: ${t.pct}% (was 37.5%), notable or with hours data: ${temples.length}/${temples.length}`);
  });
  it("does NOT keep every plain shrine (no name-worthy data, no hours data), nor an unnamed one", () => {
    expect(byId.t01.admitted).toBe(false);
    expect(byId.t32.admitted).toBe(false);
    expect(byId.t09.admitted).toBe(false);   // a plain mosque, same rule
  });
  it("keeps all four hours-related tags", () => {
    for (const k of ["service_times", "opening_hours:url", "check_date", "website"]) {
      const row = sum.hoursTagsKept.find((x) => x.tag === k);
      if (row) expect(row.pct, k).toBe(100);
    }
    const r = rec({ amenity: "place_of_worship", wikidata: "Q1", name: "X", service_times: "Mo 06:00-07:00", "opening_hours:url": "https://e.org/t", check_date: "2026-01-02", "contact:website": "https://e.org", alt_name: "Y", phone: "+91 99999" });
    expect(r?.tags).toMatchObject({ service_times: "Mo 06:00-07:00", "opening_hours:url": "https://e.org/t", check_date: "2026-01-02", "contact:website": "https://e.org", alt_name: "Y" });
    expect(r?.tags.phone).toBeUndefined();   // still no personal details
    console.log(`[admission] hours tags kept: ${sum.hoursTagsKept.map((x) => `${x.tag} ${x.pct}%`).join(", ")}`);
  });
  it("nothing that used to be kept is dropped now", () => {
    for (const id of ["t04", "t05", "t12", "t13", "t14", "t16", "t17", "t18", "t19", "t21", "t28", "t29", "t30"]) expect(byId[id].admitted, id).toBe(true);
  });
});

describe("the place catalogue keeps the map's hours facts", () => {
  const feat = (tags: Record<string, string>) => ({ type: "Feature", geometry: { type: "Point", coordinates: [78.4, 17.4] }, properties: { "@type": "node", "@id": 1, name: "A Temple", amenity: "place_of_worship", ...tags } });
  it("service times, the hours page and the check date", () => {
    const r = featureToRow(feat({ service_times: "Mo-Su 05:00-12:00", "opening_hours:url": "https://example.org/timings", "check_date:opening_hours": "2025-12-01", check_date: "2020-01-01" }));
    expect(r).toMatchObject({ service_times: "Mo-Su 05:00-12:00", hours_url: "https://example.org/timings", check_date: "2025-12-01" });
    expect(rowOk(r!)).toBe(true);
  });
  it("a check date that isn't a real day is not trusted", () => {
    expect(checkDate("2025-02-30")).toBeNull(); expect(checkDate("2025-02")).toBeNull(); expect(checkDate("yesterday")).toBeNull(); expect(checkDate("1999-01-01")).toBeNull();
    expect(featureToRow(feat({ check_date: "2025-13-01" }))?.check_date).toBeNull();
    expect(featureToRow(feat({ "opening_hours:url": "javascript:alert(1)" }))?.hours_url).toBeNull();
  });
});
