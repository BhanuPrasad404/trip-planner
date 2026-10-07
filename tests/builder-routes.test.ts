import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrip } from "@/lib/trip-builder";
import { inputSignature } from "@/lib/server/builder";
import { makeInput } from "./builder-fixtures";

const UID = "11111111-1111-1111-1111-111111111111";
const TRIP = "22222222-2222-2222-2222-222222222222";
const state = { user: { id: UID } as { id: string } | null, quotaOk: true, upserts: [] as unknown[][], upsertError: null as { message: string } | null, load: null as unknown };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
    from: () => ({ upsert: async (rows: unknown[]) => (state.upserts.push(rows), { error: state.upsertError }) }),
  }),
}));
vi.mock("@/lib/server/trip-data", () => ({ todayISO: async () => "2026-10-07" }));
vi.mock("@/lib/server/builder", async (orig) => ({ ...(await orig<typeof import("@/lib/server/builder")>()), loadBuilder: vi.fn(async () => state.load) }));

import { POST as preview } from "@/app/api/trips/[id]/builder/route";
import { POST as applyPlan } from "@/app/api/trips/[id]/builder/apply/route";

const params = { params: Promise.resolve({ id: TRIP }) };
const json = (body: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const specs = [{ name: "Lonavala" }, { name: "Khandala" }, { name: "Mahabaleshwar" }, { name: "Nashik" }, { name: "Ajanta" }, { name: "Ellora" }];

function loaded(numDays = 2) {
  const input = makeInput(specs, { numDays });
  return { ok: true, input, result: buildTrip(input, ["relaxed"]), signature: inputSignature(input), unscheduledIds: [] };
}

beforeEach(() => { state.user = { id: UID }; state.quotaOk = true; state.upserts = []; state.upsertError = null; state.load = loaded(); });

describe("input signature (what the traveller was shown)", () => {
  it("is stable for the same input and changes when places, priorities, days or ends change", () => {
    const a = makeInput(specs, { numDays: 3 });
    expect(inputSignature(a)).toBe(inputSignature(makeInput(specs, { numDays: 3 })));
    expect(inputSignature(a)).not.toBe(inputSignature(makeInput(specs, { numDays: 4 })));
    expect(inputSignature(a)).not.toBe(inputSignature({ ...a, places: a.places.map((p, i) => (i === 0 ? { ...p, priority: "must" as const } : p)) }));
    expect(inputSignature(a)).not.toBe(inputSignature({ ...a, endMode: "start" }));
    expect(inputSignature(a)).not.toBe(inputSignature({ ...a, places: a.places.slice(1) }));
    expect(inputSignature(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("POST /api/trips/[id]/builder (preview — saves nothing)", () => {
  it("needs sign-in, a valid trip id, and respects the daily limit", async () => {
    state.user = null;
    expect((await preview(json({}), params)).status).toBe(401);
    state.user = { id: UID };
    expect((await preview(json({}), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400);
    state.quotaOk = false;
    expect((await preview(json({}), params)).status).toBe(429);
  });
  it("returns the result and signature, and writes nothing", async () => {
    const res = await preview(json({ end_mode: "start" }), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.options[0].style).toBe("relaxed");
    expect(body.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(state.upserts).toHaveLength(0);
  });
  it("passes the loader's refusal through (trip under way, too many places, no start)", async () => {
    state.load = { ok: false, status: 409, error: "This trip is already under way." };
    const res = await preview(json({}), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/under way/);
  });
  it("rejects unknown options", async () => {
    expect((await preview(json({ end_mode: "teleport" }), params)).status).toBe(400);
    expect((await preview(json({ styles: ["balanced", "chaos"] }), params)).status).toBe(400);
  });
});

describe("POST /api/trips/[id]/builder/apply", () => {
  const body = (sig: string) => ({ style: "relaxed", end_mode: "free", signature: sig });
  it("refuses a stale preview: if places changed since, nothing is written", async () => {
    const res = await applyPlan(json(body("0".repeat(64))), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed since/);
    expect(state.upserts).toHaveLength(0);
  });
  it("writes the SERVER's plan (never the client's): day, order, arrival time, drive leg — and sends dropped places back to Ideas, all in one statement", async () => {
    const l = loaded() as ReturnType<typeof loaded>;
    state.load = l;
    const res = await applyPlan(json(body(l.signature)), params);
    expect(res.status).toBe(200);
    const out = await res.json();
    const option = l.result.options[0];
    expect(state.upserts).toHaveLength(1);                                   // ONE upsert = all stops move or none do
    const rows = state.upserts[0] as { id: string; day_number: number | null; sequence_order: number | null; arrival_time: string | null; trip_id: string }[];
    expect(rows).toHaveLength(l.input.places.length);                        // every place accounted for: placed or sent to Ideas
    for (const r of rows) expect(r.trip_id).toBe(TRIP);
    const placed = rows.filter((r) => r.day_number !== null);
    expect(placed).toHaveLength(option.kept.length);
    expect(placed.every((r) => /^\d\d:\d\d$/.test(r.arrival_time ?? ""))).toBe(true);
    const dropped = rows.filter((r) => r.day_number === null);
    expect(dropped.map((r) => r.id).sort()).toEqual(option.removed.map((r) => r.placeId).sort());
    expect(dropped.every((r) => r.sequence_order === null && r.arrival_time === null)).toBe(true);
    expect(out).toMatchObject({ ok: true, placed: option.kept.length, movedToIdeas: option.removed.length });
  });
  it("needs sign-in, validates its input, reports database failures, and is rate limited", async () => {
    const l = loaded();
    state.load = l;
    state.user = null;
    expect((await applyPlan(json(body(l.signature)), params)).status).toBe(401);
    state.user = { id: UID };
    expect((await applyPlan(json({ style: "relaxed" }), params)).status).toBe(400);
    state.upsertError = { message: "boom" };
    expect((await applyPlan(json(body(l.signature)), params)).status).toBeGreaterThanOrEqual(400);
    state.upsertError = null;
    state.quotaOk = false;
    expect((await applyPlan(json(body(l.signature)), params)).status).toBe(429);
  });
});
