import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "owner" } as { id: string } | null, trip: { id: "t", owner_id: "owner" } as { id: string; owner_id: string } | null, findError: null as { code?: string; message?: string } | null, updateError: null as { code?: string; message?: string } | null, updated: [{ id: "t" }] as { id: string }[], patches: [] as Record<string, unknown>[], tables: [] as string[] };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => { state.tables.push(t); return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.trip, error: state.findError }) }) }),
      update: (patch: Record<string, unknown>) => { state.patches.push(patch); return { eq: () => ({ select: async () => ({ data: state.updated, error: state.updateError }) }) }; },
    }; },
  }),
}));
import { POST } from "@/app/api/trips/[id]/lifecycle/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, id = ID) => POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
beforeEach(() => { state.user = { id: "owner" }; state.trip = { id: "t", owner_id: "owner" }; state.findError = null; state.updateError = null; state.updated = [{ id: "t" }]; state.patches = []; state.tables = []; vi.useRealTimers(); });

describe("POST /api/trips/[id]/lifecycle", () => {
  it("needs a real trip id, a signed-in person, valid JSON and a valid decision, and writes nothing otherwise", async () => {
    expect((await call({ action: "resume" }, "nope")).status).toBe(400);
    state.user = null; expect((await call({ action: "resume" })).status).toBe(401);
    state.user = { id: "owner" };
    expect((await call("not json")).status).toBe(400);
    for (const b of [{}, { action: "delete" }, { action: "resume", day_end_min: 5000 }]) expect((await call(b)).status).toBe(400);
    expect(state.patches).toEqual([]);
  });
  it("only the owner may decide: a member is told so, and nothing is written", async () => {
    state.trip = { id: "t", owner_id: "someone-else" };
    const r = await call({ action: "finish" });
    expect(r.status).toBe(403); expect((await r.json()).error).toMatch(/owner/); expect(state.patches).toEqual([]);
  });
  it("a trip that is not there (or not yours to see) is a 404, not a hint that it exists", async () => {
    state.trip = null; expect((await call({ action: "finish" })).status).toBe(404);
    state.trip = { id: "t", owner_id: "owner" }; state.updated = []; expect((await call({ action: "finish" })).status).toBe(404);
  });
  it("RESUME records the decision, clears any closing, keeps the time budget, and touches nothing else", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T04:00:00Z"));
    const r = await call({ action: "resume", day_end_min: 1290 });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, action: "resume" });
    expect(state.patches).toEqual([{ resumed_at: "2026-10-15T04:00:00.000Z", closed_at: null, closed_reason: null, resume_day_end_min: 1290 }]);
    expect(state.tables).not.toContain("places"); // stops and their progress are never touched
    expect(Object.keys(state.patches[0]).some((k) => /date|num_days|status/.test(k))).toBe(false); // planned dates are never touched
  });
  it("resume without a time budget stores none (it never invents one)", async () => {
    await call({ action: "resume" }); expect(state.patches[0]).toMatchObject({ resume_day_end_min: null });
  });
  it("FINISH and CANCEL close the trip with the right reason (and never write a stop)", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
    await call({ action: "finish" }); await call({ action: "cancel" });
    expect(state.patches).toEqual([{ closed_at: "2026-10-15T09:00:00.000Z", closed_reason: "finished" }, { closed_at: "2026-10-15T09:00:00.000Z", closed_reason: "cancelled" }]);
    expect(state.tables.every((t) => t === "trips")).toBe(true);
  });
  it("REOPEN clears only the closing, keeping whether it was resumed", async () => {
    await call({ action: "reopen" }); expect(state.patches).toEqual([{ closed_at: null, closed_reason: null }]);
  });
  it("a client cannot sneak a date change or a status in through the body", async () => {
    await call({ action: "finish", start_date: "2031-01-01", num_days: 9, status: "done" });
    expect(Object.keys(state.patches[0]).sort()).toEqual(["closed_at", "closed_reason"]);
  });
  it("before the migration is applied it says so plainly (503), and nothing was lost", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const e of [{ code: "42703", message: "column \"resumed_at\" of relation \"trips\" does not exist" }, { code: "PGRST204", message: "Could not find the 'closed_at' column of 'trips' in the schema cache" }]) {
      state.updateError = e; const r = await call({ action: "resume" });
      expect(r.status).toBe(503); expect((await r.json()).error).toMatch(/database update that hasn't been applied/);
    }
    log.mockRestore();
  });
  it("recognises the missing-column error by its CODE alone, not only by its wording (messages differ between database versions)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const code of ["42703", "PGRST204"]) { state.updateError = { code, message: "something unrelated" }; expect((await call({ action: "finish" })).status).toBe(503); }
    state.updateError = { code: "XX000", message: "column \"resumed_at\" of relation \"trips\" does not exist" }; expect((await call({ action: "finish" })).status).toBe(503); // and by wording alone
    log.mockRestore();
  });
  it("other database errors give a safe message, never the raw error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.updateError = { code: "XX000", message: "connection string postgres://secret" };
    const r = await call({ action: "finish" }); expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain("secret");
    log.mockRestore();
  });
});
