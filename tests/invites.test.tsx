// Task 4: a new invite link on demand (the old one dies at once), optional expiry, throttled joining, clear join messages.
import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/", redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
const clock = { minute: 0 };
vi.mock("@/lib/client/use-now", () => ({ useNowMinute: () => clock.minute }));
const sent: string[] = [];
vi.mock("@/lib/client/stop-signal", () => ({ announceTripStatus: async (_t: string, e: string) => { sent.push(e); } }));

const rpcAnswers: Record<string, { data: unknown; error: unknown }> = {};
const rpcCalls: string[] = [];
const fakeSb = { rpc: async (name: string, args: unknown) => { rpcCalls.push(`${name}:${JSON.stringify(args)}`); return rpcAnswers[name] ?? { data: null, error: null }; } } as unknown as SupabaseClient;
const serverUser = { current: { id: "owner" } as { id: string } | null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ ...fakeSb, auth: { getUser: async () => ({ data: { user: serverUser.current } }) } }) }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: fakeSb, user: { id: "u" } }) }));

import { joinWithInvite, rotateInvite } from "@/lib/server/invites";
import { POST as invitePOST } from "@/app/api/trips/[id]/invite/route";
import JoinPage from "@/app/join/[code]/page";
import { InvitePanel, expiryText } from "@/components/InvitePanel";

const TRIP = "11111111-0000-4000-8000-0000000000d4";
beforeEach(() => { for (const k of Object.keys(rpcAnswers)) delete rpcAnswers[k]; rpcCalls.length = 0; sent.length = 0; });

describe("rotateInvite", () => {
  it("returns the new code and expiry from the database function", async () => {
    rpcAnswers.rotate_trip_invite = { data: [{ invite_code: "abcdef0123456789", invite_expires_at: "2026-10-23T09:00:00Z" }], error: null };
    expect(await rotateInvite(fakeSb, TRIP, 168)).toEqual({ ok: true, code: "abcdef0123456789", expiresAt: "2026-10-23T09:00:00Z" });
    expect(rpcCalls).toEqual([`rotate_trip_invite:${JSON.stringify({ p_trip: TRIP, p_expires_in_hours: 168 })}`]);
  });
  it("refusals in plain words; the current link is said to still work", async () => {
    for (const [code, status] of [["42501", 403], ["22023", 400], ["PGRST202", 503], ["XX000", 500]] as const) {
      rpcAnswers.rotate_trip_invite = { data: null, error: { code, message: "x" } };
      const r = await rotateInvite(fakeSb, TRIP, null);
      expect(r).toMatchObject({ ok: false, status });
    }
  });
});

describe("joinWithInvite", () => {
  it("a malformed code is refused without asking the database", async () => {
    expect(await joinWithInvite(fakeSb, "../etc")).toEqual({ status: "invalid", tripId: null });
    expect(rpcCalls).toEqual([]);
  });
  it.each(["joined", "already_member", "invalid", "expired", "too_many_attempts"] as const)("passes on '%s'", async (status) => {
    rpcAnswers.join_trip_with_invite = { data: { status, trip_id: status.includes("j") || status === "already_member" ? TRIP : undefined }, error: null };
    expect((await joinWithInvite(fakeSb, "abcdef012345")).status).toBe(status);
  });
  it("before the migration: falls back to the old function", async () => {
    rpcAnswers.join_trip_with_invite = { data: null, error: { code: "PGRST202", message: "missing" } };
    rpcAnswers.join_trip_by_code = { data: TRIP, error: null };
    expect(await joinWithInvite(fakeSb, "abcdef012345")).toEqual({ status: "joined", tripId: TRIP });
  });
});

describe("POST /api/trips/[id]/invite", () => {
  const post = (id: string, body: unknown) => invitePOST(new Request("https://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  beforeEach(() => { serverUser.current = { id: "owner" }; });
  it("checks the id, the sign-in and the expiry choice", async () => {
    expect((await post("nope", { expires_in_hours: null })).status).toBe(400);
    serverUser.current = null;
    expect((await post(TRIP, { expires_in_hours: null })).status).toBe(401);
    serverUser.current = { id: "owner" };
    expect((await post(TRIP, { expires_in_hours: 5 })).status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });
  it("a member is refused (the database decides); the owner gets the new link", async () => {
    rpcAnswers.rotate_trip_invite = { data: null, error: { code: "42501", message: "x" } };
    expect((await post(TRIP, { expires_in_hours: 24 })).status).toBe(403);
    rpcAnswers.rotate_trip_invite = { data: [{ invite_code: "abcdef0123456789", invite_expires_at: null }], error: null };
    const res = await post(TRIP, { expires_in_hours: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, invite_code: "abcdef0123456789", invite_expires_at: null });
  });
});

describe("the join page says what happened", () => {
  const open = async (code: string) => {
    try { return renderToStaticMarkup(await JoinPage({ params: Promise.resolve({ code }) })); }
    catch (e) { return String((e as Error).message); }
  };
  it("joined or already a member → straight to the trip", async () => {
    rpcAnswers.join_trip_with_invite = { data: { status: "joined", trip_id: TRIP }, error: null };
    expect(await open("abcdef012345")).toBe(`REDIRECT:/trips/${TRIP}`);
    rpcAnswers.join_trip_with_invite = { data: { status: "already_member", trip_id: TRIP }, error: null };
    expect(await open("abcdef012345")).toBe(`REDIRECT:/trips/${TRIP}`);
  });
  it.each([
    ["invalid", "replaced"],
    ["expired", "has expired"],
    ["too_many_attempts", "wait an hour"],
  ])("%s → a clear message", async (status, text) => {
    rpcAnswers.join_trip_with_invite = { data: { status }, error: null };
    expect(await open("abcdef012345")).toContain(text);
  });
});

describe("InvitePanel", () => {
  const URL = "https://trailmate.app/join/abcdef0123456789";
  const html = (p: Partial<Parameters<typeof InvitePanel>[0]>) => renderToStaticMarkup(createElement(InvitePanel, { inviteUrl: URL, tripName: "Hampi", tripId: TRIP, ...p }));
  beforeEach(() => { clock.minute = Math.floor(Date.UTC(2026, 9, 16, 6, 0) / 60_000); });

  it("everyone sees the link and when it stops working; only the owner can make a new one", () => {
    const member = html({ isOwner: false, expiresAt: "2026-10-18T09:00:00Z" });
    expect(member).toContain(URL);
    expect(member).toContain(`Expires ${expiryText("2026-10-18T09:00:00Z")}`);
    expect(member).not.toContain("New invite link");
    expect(html({ isOwner: true })).toContain("New invite link");
    expect(html({ isOwner: true })).toContain("Never expires");
  });
  it("an expired link is not offered for sharing; members are told to ask the owner", async () => {
    // the browser's clock is past the expiry (the server render can't know the time, so it is decided client-side)
    let tr!: TestRenderer.ReactTestRenderer;
    act(() => { tr = TestRenderer.create(createElement(InvitePanel, { inviteUrl: URL, tripName: "Hampi", tripId: TRIP, isOwner: false, expiresAt: "2026-10-16T05:00:00Z" })); });
    const t = JSON.stringify(tr.toJSON());
    expect(t).toContain("This link has expired. Ask the trip owner");
    expect(t).not.toContain(URL);
    act(() => tr.unmount());
  });
  it("the owner makes a new link: says the old one dies at once, sends the chosen expiry, refreshes, tells the others", async () => {
    let fetched: { url: string; body: string } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { fetched = { url, body: init.body as string }; return { ok: true, status: 200, json: async () => ({ ok: true }) }; });
    let tr!: TestRenderer.ReactTestRenderer;
    act(() => { tr = TestRenderer.create(createElement(InvitePanel, { inviteUrl: URL, tripName: "Hampi", tripId: TRIP, isOwner: true })); });
    const btn = (label: string) => tr.root.findAllByType("button").find((b) => JSON.stringify(b.props.children).includes(label))!;
    await act(async () => { btn("New invite link").props.onClick(); });
    expect(JSON.stringify(tr.toJSON())).toContain("The old link stops working at once");
    act(() => { tr.root.findByType("select").props.onChange({ target: { value: "168" } }); });
    await act(async () => { await btn("Make new link").props.onClick(); });
    expect(fetched).toEqual({ url: `/api/trips/${TRIP}/invite`, body: JSON.stringify({ expires_in_hours: 168 }) });
    expect(router.refresh).toHaveBeenCalled();
    expect(sent).toEqual(["members-changed"]);
    expect(JSON.stringify(tr.toJSON())).toContain("The old link no longer works");
    act(() => tr.unmount());
    vi.unstubAllGlobals();
  });
});
