import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrip } from "@/lib/trip-builder";
import { inputSignature } from "@/lib/server/builder";
import { parseRoadLine, prefsFrom, refDate, weatherMode } from "@/lib/server/trip-engine";
import { makeInput } from "./builder-fixtures";

const UID = "11111111-1111-1111-1111-111111111111";
const TRIP = "22222222-2222-2222-2222-222222222222";
const state = { user: { id: UID } as { id: string } | null, upserts: [] as unknown[][], load: null as unknown, heightsFail: false, deletes: [] as string[] };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: true, error: null }),
    from: () => ({
      upsert: async (rows: unknown[]) => (state.upserts.push(rows), { error: null }),
      // .delete().eq(..).eq(..)[.not(..)]: records what it was asked to remove (the old plan halts)
      delete: () => { const c: Record<string, unknown> = { eq: (k: string, v: string) => (state.deletes.push(`${k}=${v}`), c), not: (k: string, op: string, v: string) => (state.deletes.push(`${k} ${op} ${v}`), c), then: (res: (v: unknown) => void) => res({ error: null }) }; return c; },
    }),
  }),
}));
vi.mock("@/lib/server/trip-data", () => ({ todayISO: async () => "2026-10-22" }));
vi.mock("@/lib/server/builder", async (orig) => ({ ...(await orig<typeof import("@/lib/server/builder")>()), loadBuilder: vi.fn(async () => state.load) }));
vi.mock("@/lib/providers/registry", async (orig) => ({
  ...(await orig<typeof import("@/lib/providers/registry")>()),
  elevationProvider: () => ({ id: "test", maxPoints: 100, elevations: async (pts: unknown[]) => { if (state.heightsFail) throw new Error("down"); return pts.map(() => 600); } }),
}));

import { POST as preview } from "@/app/api/trips/[id]/builder/route";
import { POST as applyPlan } from "@/app/api/trips/[id]/builder/apply/route";

const params = { params: Promise.resolve({ id: TRIP }) };
const json = (body: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const specs = [{ name: "Lonavala" }, { name: "Khandala" }, { name: "Mahabaleshwar" }, { name: "Pune" }];

function loaded(intake: unknown = { pace: "relaxed", night_driving: false }) {
  const input = makeInput(specs, { numDays: 2, startDateISO: "2026-12-12", endMode: "start" });
  return { ok: true, input, result: buildTrip(input, []), signature: inputSignature(input), unscheduledIds: [], trip: { id: TRIP, intake }, skipped: [] as { id: string; name: string; lat: number; lng: number }[] };
}

beforeEach(() => { state.user = { id: UID }; state.upserts = []; state.deletes = []; state.load = loaded(); state.heightsFail = false; });

describe("Plan my trip with the engine", () => {
  it("preview sends Relaxed / Balanced / Most places and the engine's extras; saves nothing", async () => {
    const res = await preview(json({ end_mode: "start", engine: true }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.options.map((o: { label: string }) => o.label)).toEqual(["Relaxed", "Balanced", "Most places"]);
    expect(body.result.options.map((o: { style: string }) => o.style)).toEqual(["relaxed", "balanced", "explorer"]);
    expect(body.engine.recommendedStyle).toBe("relaxed"); // the traveller's pace from the guided flow
    expect(body.engine.labels.margin).toMatch(/\+15%/);
    expect(body.engine.labels.weather).toMatch(/TYPICAL/); // December is more than 16 days from 22 October
    expect(body.engine.variants).toHaveLength(3);
    expect(body.engine.variants[0].whatIf.length).toBeGreaterThan(0);
    expect(body.duration).toBeUndefined();
    expect(state.upserts).toHaveLength(0);
  });
  it("still plans when the height service is down (no hill margin claimed)", async () => {
    state.heightsFail = true;
    const res = await preview(json({ engine: true, end_mode: "start" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).engine.variants).toHaveLength(3);
  });
  it("a night-driving override reaches the engine", async () => {
    const body = await (await preview(json({ engine: true, night_driving: true }), params)).json();
    expect(body.engine.nightDriving).toBe(true);
    expect(body.engine.labels.daylight).toMatch(/allowed driving after dark/);
  });
  it("without engine: the old builder answer, unchanged", async () => {
    state.load = { ...loaded(), result: buildTrip(loaded().input, ["relaxed"]) };
    const body = await (await preview(json({}), params)).json();
    expect(body.engine).toBeUndefined();
    expect(body.duration).toBeTruthy();
  });
  it("apply writes the engine's plan for the chosen variant (re-computed on the server)", async () => {
    const sig = (state.load as { signature: string }).signature;
    const res = await applyPlan(json({ style: "explorer", end_mode: "start", signature: sig, engine: true }), params);
    expect(res.status).toBe(200);
    const rows = state.upserts[0] as { id: string; day_number: number | null }[];
    expect(rows).toHaveLength(4);
    for (const r of rows) if (r.day_number !== null) expect(r.day_number).toBeGreaterThanOrEqual(1);
  });
  it("a far trip: each drive day is saved as a stop (the night halt), so the day is not empty on Plan, Map and Live", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });   // no road service: the engine's own estimated road is used
    try {
      const input = makeInput([{ name: "Goa", category: "beach" }, { name: "Kolhapur" }], { numDays: 5, start: "Mumbai", startDateISO: "2026-12-12", endMode: "start" });
      state.load = { ok: true, input, result: buildTrip(input, []), signature: inputSignature(input), unscheduledIds: [], trip: { id: TRIP, intake: { pace: "balanced", night_driving: false } }, skipped: [] };
      const res = await applyPlan(json({ style: "balanced", end_mode: "start", signature: (state.load as { signature: string }).signature, engine: true }), params);
      expect(res.status).toBe(200);
      const rows = state.upserts[0] as { name: string; day_number: number | null; source_type?: string; category?: string; lat: number; lng: number; added_by?: string; drive_minutes: number | null }[];
      const halts = rows.filter((r) => r.source_type === "plan_halt");
      expect(halts.length).toBeGreaterThan(0);
      for (const h of halts) {
        expect(h).toMatchObject({ category: "stay", added_by: UID });
        expect(h.day_number).toBeGreaterThanOrEqual(1); expect(Number.isFinite(h.lat) && Number.isFinite(h.lng)).toBe(true); expect(h.name.length).toBeGreaterThan(1);
      }
      // the drive days are the ones with a halt and no sightseeing stop of the plan's own
      const sightDays = new Set(rows.filter((r) => r.source_type !== "plan_halt" && r.day_number !== null).map((r) => r.day_number));
      expect(halts.some((h) => !sightDays.has(h.day_number))).toBe(true);
      expect(new Set(halts.map((h) => h.day_number)).size).toBe(halts.length);       // one halt per day
      expect((await res.json()).halts).toBe(halts.length);
      // the halts of an earlier plan are replaced, never piled up
      expect(state.deletes).toEqual(expect.arrayContaining([`trip_id=${TRIP}`, "source_type=plan_halt"]));
      expect(state.deletes.some((d) => d.startsWith("id in ("))).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it("a trip near home has no drive days, so no halts are saved (and old ones are cleared)", async () => {
    const sig = (state.load as { signature: string }).signature;
    await applyPlan(json({ style: "balanced", end_mode: "start", signature: sig, engine: true }), params);
    expect((state.upserts[0] as { source_type?: string }[]).filter((r) => r.source_type === "plan_halt")).toHaveLength(0);
    expect(state.deletes).toEqual(expect.arrayContaining(["source_type=plan_halt"]));
    expect(state.deletes.some((d) => d.startsWith("id in"))).toBe(false);
  });
  it("Skip this place: the list reaches the planner, and on Use this plan the skipped place goes back to Ideas", async () => {
    const { loadBuilder } = await import("@/lib/server/builder");
    const SKIP = "33333333-3333-3333-3333-333333333333";
    await preview(json({ engine: true, end_mode: "start", skip: [SKIP] }), params);
    expect(vi.mocked(loadBuilder).mock.calls.at(-1)![2]).toMatchObject({ skip: [SKIP] });
    state.load = { ...loaded(), skipped: [{ id: SKIP, name: "Skipped Fort", lat: 18.5, lng: 73.8 }] };
    const sig = (state.load as { signature: string }).signature;
    const res = await applyPlan(json({ style: "balanced", end_mode: "start", signature: sig, engine: true, skip: [SKIP] }), params);
    expect(res.status).toBe(200);
    const row = (state.upserts[0] as { id: string; day_number: number | null; name: string }[]).find((r) => r.id === SKIP)!;
    expect(row).toMatchObject({ day_number: null, name: "Skipped Fort" });
  });
  it("rejects a skip list that isn't place ids", async () => {
    expect((await preview(json({ engine: true, skip: ["nope"] }), params)).status).toBe(400);
  });
  it("rejects a bad driving limit", async () => {
    expect((await preview(json({ engine: true, max_drive_hours: 40 }), params)).status).toBe(400);
  });
});

describe("server helpers", () => {
  it("weather: forecast within 16 days, typical beyond, mixed across, none without dates", () => {
    expect(weatherMode("2026-10-25", 3, "2026-10-22")).toBe("forecast");
    expect(weatherMode("2026-12-12", 3, "2026-10-22")).toBe("typical");
    expect(weatherMode("2026-11-05", 5, "2026-10-22")).toBe("mixed");
    expect(weatherMode(null, 3, "2026-10-22")).toBe("none");
  });
  it("sunset date: trip start, else the month said, else today", () => {
    expect(refDate("2026-11-01", 3, "2026-10-22")).toBe("2026-11-01");
    expect(refDate(null, 12, "2026-10-22")).toBe("2026-12-15");
    expect(refDate(null, 2, "2026-10-22")).toBe("2027-02-15");
    expect(refDate(null, null, "2026-10-22")).toBe("2026-10-22");
  });
  it("prefs from the saved answers, overrides win, junk ignored", () => {
    expect(prefsFrom({ pace: "packed", group: "family_kids", max_drive_hours: 5, night_driving: true, interests: ["temples", 3], mode: "bike" })).toEqual({ pace: "packed", group: "family_kids", maxDriveHours: 5, nightDriving: true, interests: ["temples"], mode: "bike", avoid: [], stay: null });
    expect(prefsFrom(null)).toMatchObject({ pace: "balanced", nightDriving: false, group: null, mode: "car" });
    expect(prefsFrom({ pace: "warp", night_driving: true }, { night_driving: false })).toMatchObject({ pace: "balanced", nightDriving: false });
    // what to avoid and the kind of stay now reach the planner (labels from the screen and the traveller's own words both work)
    expect(prefsFrom({ avoid: ["Long drives", "no treks please", "Crowded places", 7], stay: "homestay" })).toMatchObject({ avoid: ["long_drives", "long_walks", "crowds"], stay: "homestay" });
    expect(prefsFrom({ stay: "castle" }).stay).toBeNull();
    expect(prefsFrom({ night_driving: true, avoid: ["Driving at night"] }).nightDriving).toBe(false); // an explicit "avoid" beats a stored yes
  });
  it("reads an OSRM road line with per-stretch times, merging short stretches", () => {
    const coords = Array.from({ length: 11 }, (_, i) => [78 + i * 0.001, 17]);
    const json = { code: "Ok", routes: [{ geometry: { coordinates: coords }, legs: [{ annotation: { duration: Array(10).fill(30), distance: Array(10).fill(300) } }] }] };
    const l = parseRoadLine(json)!;
    expect(l.durations.reduce((a, b) => a + b, 0)).toBe(300);
    expect(l.distances.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(l.coords.length).toBe(l.durations.length + 1);
    expect(Math.min(...l.distances.slice(0, -1))).toBeGreaterThanOrEqual(1000);
    expect(parseRoadLine({ code: "NoRoute" })).toBeNull();
    expect(parseRoadLine({ code: "Ok", routes: [{ geometry: { coordinates: coords }, legs: [{ annotation: { duration: [1], distance: [1] } }] }] })).toBeNull();
  });
});
