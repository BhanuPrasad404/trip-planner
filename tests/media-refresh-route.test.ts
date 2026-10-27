import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null, allow: true, asked: [] as string[][] };
vi.mock("@/lib/rate-limit", () => ({ rateLimiter: { take: () => state.allow } }));
vi.mock("@/lib/social/storage", () => ({ supabaseMediaStorage: () => ({}) }));
vi.mock("@/lib/server/feed-service", () => ({
  loadMedia: async (_s: unknown, _st: unknown, ids: string[]) => { state.asked.push(ids); return new Map([[ids[0], [{ type: "image", url: "https://s/fresh?t=1", posterUrl: null, width: 1, height: 1, durationS: null }]]]); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
import { POST } from "@/app/api/feed/media/route";

const A = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333";
const call = (body: unknown) => POST(new Request("http://x/api/feed/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => { state.user = { id: "11111111-1111-4111-8111-111111111111" }; state.allow = true; state.asked = []; });

describe("POST /api/feed/media", () => {
  it("signed-in only", async () => { state.user = null; expect((await call({ ids: [A] })).status).toBe(401); });
  it("refuses bad or too many ids before touching the database", async () => {
    expect((await call({ ids: ["nope"] })).status).toBe(400);
    expect((await call({ ids: [] })).status).toBe(400);
    expect((await call({ ids: Array.from({ length: 13 }, () => A) })).status).toBe(400);
    expect(state.asked).toHaveLength(0);
  });
  it("rate limited", async () => { state.allow = false; expect((await call({ ids: [A] })).status).toBe(429); });
  it("returns fresh links for every asked post (none for a post that is gone), never cached", async () => {
    const res = await call({ ids: [A, B, A] });
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(state.asked[0]).toEqual([A, B]);
    const body = await res.json();
    expect(body.media[A][0].url).toBe("https://s/fresh?t=1"); expect(body.media[B]).toEqual([]);
  });
});
