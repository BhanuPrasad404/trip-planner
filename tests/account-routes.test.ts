import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "u1", email: "ann@example.com" } as { id: string; email: string } | null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
const buildAccountExport = vi.fn(async () => ({ hello: "world" }));
const deleteAccount = vi.fn(async (): Promise<{ ok: true } | { ok: false; status: number; error: string }> => ({ ok: true }));
vi.mock("@/lib/server/account", () => ({ buildAccountExport: (...a: unknown[]) => buildAccountExport(...(a as [])), exportFileName: () => "trailmate-my-data-2026-10-12.json", deleteAccount: (...a: unknown[]) => deleteAccount(...(a as [])) }));
vi.mock("@/lib/env", () => ({ getSupabaseEnv: () => ({ url: "https://x.supabase.co", anonKey: "k" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) }));
import { GET as exportGET } from "@/app/api/account/export/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";

const post = (body: unknown) => deletePOST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.user = { id: `u-${Math.random()}`, email: "ann@example.com" }; buildAccountExport.mockClear(); deleteAccount.mockClear(); deleteAccount.mockResolvedValue({ ok: true }); });

describe("GET /api/account/export", () => {
  it("signed out: 401 and nothing is built", async () => {
    state.user = null;
    expect((await exportGET()).status).toBe(401);
    expect(buildAccountExport).not.toHaveBeenCalled();
  });
  it("sends a downloadable, uncached JSON file", async () => {
    const res = await exportGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="trailmate-my-data-2026-10-12.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await res.text())).toEqual({ hello: "world" });
  });
  it("is limited to 3 downloads an hour per person", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await exportGET()).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("POST /api/account/delete", () => {
  it("signed out: 401 and nothing is attempted", async () => {
    state.user = null;
    expect((await post({ confirm: "a@b.c", password: "x" })).status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("needs both the typed email and the password", async () => {
    expect((await post({ confirm: "a@b.c" })).status).toBe(400);
    expect((await post({ password: "x" })).status).toBe(400);
    expect((await post({ confirm: "a@b.c", password: "" })).status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("passes the person and their answers on, and returns ok", async () => {
    const res = await post({ confirm: "ann@example.com", password: "pw" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect((deleteAccount.mock.calls[0] as unknown as [{ input: unknown }])[0].input).toEqual({ confirm: "ann@example.com", password: "pw" });
  });
  it("relays a refusal with its own status and message", async () => {
    deleteAccount.mockResolvedValue({ ok: false, status: 403, error: "That password is not correct." });
    const res = await post({ confirm: "ann@example.com", password: "nope" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That password is not correct." });
  });
  it("limits attempts to 5 an hour (so the password cannot be guessed here)", async () => {
    deleteAccount.mockResolvedValue({ ok: false, status: 403, error: "That password is not correct." });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ confirm: "ann@example.com", password: `p${i}` })).status);
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
  });
});
