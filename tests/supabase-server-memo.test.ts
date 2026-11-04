// One request asks the Auth server "who is this?" once, not once per page, layout and navigation; a change of who is signed in forgets the answer.
import { describe, expect, it, vi } from "vitest";

const calls = { getUser: 0, updateUser: 0 };
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/env", () => ({ getSupabaseEnv: () => ({ url: "https://x.supabase.co", anonKey: "k" }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => { calls.getUser++; return { data: { user: { id: "u1" } }, error: null }; }, updateUser: async () => { calls.updateUser++; return {}; } } }),
}));
import { createClient } from "@/lib/supabase/server";

describe("createClient().auth.getUser", () => {
  it("asks the Auth server once however many times it is called, and again after the person's record changes", async () => {
    const sb = await createClient();
    const [a, b, c] = await Promise.all([sb.auth.getUser(), sb.auth.getUser(), sb.auth.getUser()]);
    expect(calls.getUser).toBe(1);
    expect([a, b, c].every((r) => r.data.user?.id === "u1")).toBe(true);
    await sb.auth.updateUser({ data: { avatar_path: null } });
    await sb.auth.getUser();
    expect(calls.getUser).toBe(2);
  });
  it("a specific token is never answered from the remembered person", async () => {
    const sb = await createClient();
    calls.getUser = 0;
    await sb.auth.getUser("some-jwt");
    await sb.auth.getUser("some-jwt");
    expect(calls.getUser).toBe(2);
  });
});
