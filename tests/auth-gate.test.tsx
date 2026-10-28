// The blinking page: the proxy trusted a token it could check locally, the page asked the Auth server and got no answer (a network
// hiccup) or "this session is gone", and redirected to /login; the proxy then bounced the "signed-in" visitor back to the app, and so on.
// These pin the fix: a hiccup is an error screen (never a redirect), a dead session reaches the login page and clears itself, and the
// proxy stops signed-out visitors before the page starts streaming.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); }, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/login" }));
vi.mock("next/link", async () => { const { createElement: h } = await import("react"); return { default: ({ href, children, ...r }: { href: string; children?: unknown }) => h("a", { href, ...r }, children as never) }; });
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
// A plain function, not vi.fn(): vitest flags a rejected promise returned by a spy as "unhandled" even when the code under test handles it.
const getUserImpl = { current: (async () => ({ data: { user: null }, error: null })) as () => Promise<unknown> };
const serverAuth = { getUser: () => getUserImpl.current() };
const setUser = (answer: unknown) => { getUserImpl.current = async () => answer; };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: serverAuth, from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) }));
const browserAuth = { signOut: vi.fn(async () => ({ error: null })), signInWithPassword: vi.fn(), signInWithOAuth: vi.fn() };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: browserAuth }) }));
const claims = { current: null as Record<string, unknown> | null };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: claims.current ? { claims: claims.current } : null }) } }) }));

import { judgeAuth, loginPath, requireUser, requireUserAnd } from "@/lib/auth";
import { updateSession } from "@/lib/supabase/proxy";
import LoginPage from "@/app/login/page";
import { StaleSessionCleaner } from "@/components/StaleSessionCleaner";

const USER = { id: "u1" } as never;
/** What a promise ended with, as text: "resolved", or "Name: message". */
const ended = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => `${(e as Error).name}: ${(e as Error).message}`);
const throwsNetwork = async () => { throw new TypeError("fetch failed"); };
type E = { name: string; status?: number };
const err = (name: string, status?: number): E => ({ name, status });

describe("what Supabase's answer means", () => {
  it("a user is fine", () => expect(judgeAuth({ data: { user: USER }, error: null })).toBe("ok"));
  it("no session at all is a normal signed-out visitor", () => {
    expect(judgeAuth({ data: { user: null }, error: null })).toBe("signed_out");
    expect(judgeAuth({ data: { user: null }, error: err("AuthSessionMissingError", 400) as never })).toBe("signed_out");
  });
  it("a network failure, a timeout or a server error is 'unavailable', never 'signed out'", () => {
    for (const e of [err("AuthRetryableFetchError", 0), err("AuthRetryableFetchError"), err("AuthApiError", 500), err("AuthApiError", 503), err("AuthUnknownError"), err("AuthApiError", 429)]) expect(judgeAuth({ data: { user: null }, error: e as never }), `${e.name} ${e.status}`).toBe("unavailable");
  });
  it("the server saying the session is invalid or gone is 'session ended'", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(judgeAuth({ data: { user: null }, error: err("AuthApiError", s) as never })).toBe("session_ended");
  });
});

describe("the page gates", () => {
  beforeEach(() => setUser({ data: { user: null }, error: null }));
  it("a signed-in person passes", async () => {
    setUser({ data: { user: USER }, error: null });
    expect((await requireUser("/discover")).user).toBe(USER);
  });
  it("a signed-out visitor goes to login with where they were going", async () => {
    setUser({ data: { user: null }, error: err("AuthSessionMissingError", 400) });
    await expect(requireUser("/discover")).rejects.toThrow("REDIRECT:/login?next=%2Fdiscover");
  });
  it("a dead session goes to login marked as ended (so it cannot loop)", async () => {
    setUser({ data: { user: null }, error: err("AuthApiError", 403) });
    await expect(requireUser("/discover")).rejects.toThrow("REDIRECT:/login?next=%2Fdiscover&session=ended");
  });
  it("a network hiccup is an error screen, NOT a redirect to login (the redirect is what made it blink)", async () => {
    setUser({ data: { user: null }, error: err("AuthRetryableFetchError", 0) });
    expect(await ended(requireUser("/discover"))).toMatch(/^AuthUnavailableError/);
    getUserImpl.current = throwsNetwork;
    expect(await ended(requireUser("/discover"))).toMatch(/^AuthUnavailableError/);
  });
  it("the same rules hold when the page loads its data at the same time", async () => {
    const load = vi.fn(async () => "data");
    setUser({ data: { user: USER }, error: null });
    expect((await requireUserAnd("/trips", load)).loaded).toBe("data");
    setUser({ data: { user: null }, error: err("AuthRetryableFetchError", 0) });
    expect(await ended(requireUserAnd("/trips", load))).toMatch(/^AuthUnavailableError/);
    setUser({ data: { user: null }, error: err("AuthApiError", 401) });
    expect(await ended(requireUserAnd("/trips", load))).toContain("session=ended");
    getUserImpl.current = throwsNetwork;
    expect(await ended(requireUserAnd("/trips", load))).toMatch(/^AuthUnavailableError/);
  });
  it("builds the login address", () => {
    expect(loginPath("/discover")).toBe("/login?next=%2Fdiscover");
    expect(loginPath("/a?b=1", true)).toBe("/login?next=%2Fa%3Fb%3D1&session=ended");
  });
});

describe("the proxy", () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"; });
  const run = (path: string) => updateSession(new NextRequest(`https://trailmate.app${path}`));
  it("stops a signed-out visitor at every signed-in page BEFORE it starts streaming", async () => {
    claims.current = null;
    for (const p of ["/trips", "/dashboard", "/discover", "/discover/abc", "/explore", "/memories", "/profile"]) expect((await run(p)).headers.get("location"), p).toBe(`https://trailmate.app/login?next=${encodeURIComponent(p)}`);
  });
  it("leaves public pages alone", async () => {
    claims.current = null;
    for (const p of ["/", "/plan", "/login", "/signup", "/terms", "/privacy", "/api/places"]) expect((await run(p)).headers.get("location"), p).toBeNull();
  });
  it("sends a signed-in visitor away from login, as before", async () => {
    claims.current = { sub: "u1" };
    expect((await run("/login")).headers.get("location")).toBe("https://trailmate.app/trips");
  });
  it("but NOT when the page said the session ended: the login page must open, or it loops", async () => {
    claims.current = { sub: "u1" };
    expect((await run("/login?next=%2Fdiscover&session=ended")).headers.get("location")).toBeNull();
  });
  it("lets a signed-in person into the pages", async () => {
    claims.current = { sub: "u1" };
    for (const p of ["/discover", "/explore", "/profile"]) expect((await run(p)).headers.get("location"), p).toBeNull();
  });
});

describe("the login page after a dead session", () => {
  it("says so and clears the stale cookie on this device", async () => {
    const el = await LoginPage({ searchParams: Promise.resolve({ next: "/discover", session: "ended" }) });
    expect(renderToStaticMarkup(el)).toContain("Your session ended. Please log in again.");
    browserAuth.signOut.mockClear();
    await act(async () => { TestRenderer.create(createElement(StaleSessionCleaner)); });
    expect(browserAuth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("shows nothing extra on a normal visit", async () => {
    const el = await LoginPage({ searchParams: Promise.resolve({ next: "/discover" }) });
    expect(renderToStaticMarkup(el)).not.toContain("session ended");
  });
});
