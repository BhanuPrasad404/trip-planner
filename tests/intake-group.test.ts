import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeGroup } from "@/lib/intake/group";

describe("where the group agrees and splits — both sides shown, never a side picked", () => {
  it("everyone relaxed, 3 of 4 want food: those become the defaults", () => {
    const s = summarizeGroup([
      { answers: { pace: "relaxed", interests: ["food", "beaches"], avoid: [] } },
      { answers: { pace: "relaxed", interests: ["food"], avoid: ["night_driving"] } },
      { answers: { pace: "relaxed", interests: ["food", "adventure"], avoid: [] } },
      { answers: { pace: "relaxed", interests: ["beaches"], avoid: [] } },
    ]);
    expect(s.count).toBe(4);
    expect(s.agree).toEqual(["All 4: Relaxed pace", "Food (3 of 4)"]);
    expect(s.split).toEqual(["Some want: Beaches 2 of 4 · Adventure 1 of 4", "1 of 4 would rather avoid driving at night"]);
    expect(s.defaults).toEqual({ pace: "relaxed", interests: ["food"] });
  });
  it("a real split on pace is shown with both sides, and no pace default is set", () => {
    const s = summarizeGroup([{ answers: { pace: "relaxed" } }, { answers: { pace: "relaxed" } }, { answers: { pace: "packed" } }, { answers: { pace: "packed" } }]);
    expect(s.split).toEqual(["Split on pace: Relaxed 2 · Packed 2"]);
    expect(s.defaults.pace).toBeUndefined();
  });
  it("an agreed 'no night driving' becomes the rule", () => {
    const s = summarizeGroup([{ answers: { avoid: ["night_driving", "long_drives"] } }, { answers: { avoid: ["night_driving"] } }, { answers: { avoid: ["night_driving"] } }]);
    expect(s.defaults.nightDriving).toBe(false);
    expect(s.agree).toEqual(["Avoid driving at night (all 3)"]);
    expect(s.split).toEqual(["1 of 3 would rather avoid long drives"]);
  });
  it("damaged or unknown answers are skipped, not counted", () => {
    expect(summarizeGroup([{ answers: { pace: "warp-speed" } }, { answers: null }, { answers: { interests: ["food"] } }]).count).toBe(1);
    expect(summarizeGroup([])).toEqual({ count: 0, agree: [], split: [], defaults: {} });
  });
});

// ── the friend's route, with fakes for the database ───────────────────────────────────────────────────────────────────────────
const db = { user: null as { id: string } | null, rpc: [] as { fn: string; args: Record<string, unknown>; as: string }[], status: "saved", lookup: { status: "open", trip_name: "Goa with the gang", answers: 2 } as unknown };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => (db.rpc.push({ fn, args, as: "user" }), { data: fn === "poll_lookup" ? db.lookup : fn === "consume_quota" ? true : fn === "my_group_answer" ? null : { status: db.status }, error: null }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasAdminAccess: () => true,
  createAdminClient: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => (db.rpc.push({ fn, args, as: "server" }), { data: fn === "poll_lookup" ? db.lookup : fn === "consume_visitor_quota" ? true : fn === "guest_group_answer" ? null : { status: db.status }, error: null }) }),
}));
const { GET, POST } = await import("@/app/api/poll/[code]/route");
const CODE = "0123456789abcdef";
const ctx = (code = CODE) => ({ params: Promise.resolve({ code }) });
const req = (body?: unknown) => new NextRequest(`http://localhost/api/poll/${CODE}`, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json", "x-forwarded-for": "10.1.1.1" } });

describe("answering a group link (no sign-up)", () => {
  beforeEach(() => { db.user = null; db.rpc = []; db.status = "saved"; });
  it("a guest sees only the trip's name and whether it takes answers", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body).toEqual({ status: "open", trip_name: "Goa with the gang", answers: 2, mine: null, signedIn: false });
  });
  it("a guest's answer is saved by the server under a HASHED visitor key", async () => {
    const res = await POST(req({ name: "Ravi", answers: { pace: "relaxed", interests: ["food"], avoid: ["night_driving"] } }), ctx());
    expect(res.status).toBe(200);
    const call = db.rpc.find((c) => c.fn === "submit_guest_group_answer")!;
    expect(call.as).toBe("server");
    expect(String(call.args.p_visitor_key)).toMatch(/^[0-9a-f]{40}$/);
    expect(call.args.p_answers).toEqual({ pace: "relaxed", interests: ["food"], avoid: ["night_driving"] });
  });
  it("a signed-in friend answers as themselves (no visitor key, their own database rights)", async () => {
    db.user = { id: "u1" };
    await POST(req({ name: "Priya", answers: { pace: "packed" } }), ctx());
    expect(db.rpc.find((c) => c.fn === "submit_group_answer")).toMatchObject({ as: "user" });
    expect(db.rpc.some((c) => c.fn === "submit_guest_group_answer")).toBe(false);
  });
  it("closed link, full trip, bad code and bad input each get a plain message", async () => {
    db.status = "closed";
    expect((await (await POST(req({ name: "A", answers: {} }), ctx())).json()).error).toMatch(/stopped taking answers/);
    db.status = "full";
    expect((await POST(req({ name: "A", answers: {} }), ctx())).status).toBe(409);
    expect((await POST(req({ name: "A", answers: {} }), ctx("not-a-code"))).status).toBe(404);
    expect((await POST(req({ name: "", answers: {} }), ctx())).status).toBe(400);
    expect((await POST(req({ name: "A", answers: { pace: "warp" } }), ctx())).status).toBe(400);
  });
});
