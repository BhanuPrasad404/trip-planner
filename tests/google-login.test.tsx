// Task 7: "Continue with Google" — safe ?next= redirects, and the same consent (18+, Terms, Privacy) as email sign-up.
import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/", redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));

const browserAuth = { signInWithOAuth: vi.fn(), updateUser: vi.fn(), refreshSession: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({ error: null })) };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: browserAuth }) }));
const serverAuth = { exchangeCodeForSession: vi.fn(), getUser: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: serverAuth }) }));
const proxyClaims = { current: null as Record<string, unknown> | null };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: proxyClaims.current ? { claims: proxyClaims.current } : null }) } }) }));

import { consentFree, googleRedirectTo, needsConsent, oauthErrorMessage, suggestedName, welcomeUrl } from "@/lib/oauth";
import { GoogleButton } from "@/components/GoogleButton";
import { AuthForm } from "@/components/AuthForm";
import { WelcomeForm } from "@/components/WelcomeForm";
import WelcomePage from "@/app/welcome/page";
import { GET as callbackGET } from "@/app/auth/callback/route";
import { updateSession } from "@/lib/supabase/proxy";
import { LEGAL_VERSION } from "@/lib/legal";

const google = (meta: Record<string, unknown> = {}) => ({ app_metadata: { provider: "google", providers: ["google"] }, user_metadata: meta });
const emailUser = (meta: Record<string, unknown> = {}) => ({ app_metadata: { provider: "email", providers: ["email"] }, user_metadata: meta });

describe("the rules (pure)", () => {
  it("only a Google sign-in that never agreed must agree; email accounts (old ones too) never do", () => {
    expect(needsConsent(google({ full_name: "Bhanu" }))).toBe(true);
    expect(needsConsent(google({ accepted_terms_version: LEGAL_VERSION }))).toBe(false);
    expect(needsConsent(emailUser())).toBe(false); // an older email account without a stored version is not stopped
    expect(needsConsent({ app_metadata: { provider: "email", providers: ["email", "google"] }, user_metadata: { accepted_terms_version: LEGAL_VERSION } })).toBe(false);
    expect(needsConsent(null)).toBe(false);
  });
  it("Google sends you back to OUR callback with a safe next path", () => {
    expect(googleRedirectTo("https://trailmate.app", "/trips/abc?x=1")).toBe("https://trailmate.app/auth/callback?next=%2Ftrips%2Fabc%3Fx%3D1");
    for (const evil of ["//evil.com", "https://evil.com", "/\t/evil.com", null]) expect(googleRedirectTo("https://trailmate.app", evil)).toBe("https://trailmate.app/auth/callback?next=%2Ftrips");
    expect(welcomeUrl("//evil.com")).toBe("/welcome?next=%2Ftrips");
  });
  it("the welcome step, documents and auth routes stay open before agreeing", () => {
    for (const p of ["/welcome", "/terms", "/privacy", "/auth/callback"]) expect(consentFree(p), p).toBe(true);
    for (const p of ["/trips", "/dashboard", "/welcomeback", "/profile"]) expect(consentFree(p), p).toBe(false);
  });
  it("the suggested name comes from Google when nothing was typed before", () => {
    expect(suggestedName({ full_name: "  Bhanu Prasad " })).toBe("Bhanu Prasad");
    expect(suggestedName({ display_name: "Bhanu", full_name: "B P" })).toBe("Bhanu");
    expect(suggestedName({})).toBe("");
  });
  it("errors in plain words, never the provider's raw text", () => {
    expect(oauthErrorMessage({ message: "Unsupported provider: provider is not enabled" })).toMatch(/isn't switched on/);
    expect(oauthErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toMatch(/connection/);
    expect(oauthErrorMessage({ message: "weird internal 0x55" })).not.toContain("0x55");
  });
});

describe("GoogleButton / AuthForm", () => {
  let r: TestRenderer.ReactTestRenderer;
  beforeEach(() => { browserAuth.signInWithOAuth.mockReset(); vi.stubGlobal("window", { location: { origin: "https://trailmate.app" } }); });
  afterEach(() => { act(() => r?.unmount()); vi.unstubAllGlobals(); });
  const textOf = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
  const google = () => r.root.findAllByType("button").find((b) => textOf(b).includes("Continue with Google"))!;

  it("starts Google with the account chooser and the safe callback", async () => {
    browserAuth.signInWithOAuth.mockResolvedValue({ error: null });
    act(() => { r = TestRenderer.create(createElement(GoogleButton, { next: "/trips/abc" })); });
    await act(async () => { await google().props.onClick(); });
    expect(browserAuth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://trailmate.app/auth/callback?next=%2Ftrips%2Fabc", queryParams: { prompt: "select_account" } } });
  });
  it("a provider that isn't switched on is said plainly", async () => {
    browserAuth.signInWithOAuth.mockResolvedValue({ error: { message: "Unsupported provider: provider is not enabled" } });
    act(() => { r = TestRenderer.create(createElement(GoogleButton, { next: "/trips" })); });
    await act(async () => { await google().props.onClick(); });
    expect(textOf(r.root)).toContain("isn't switched on yet");
  });
  it("on the SIGN-UP page Google needs the Terms tick first, like email sign-up", async () => {
    act(() => { r = TestRenderer.create(createElement(AuthForm, { mode: "signup", next: "/trips" })); });
    await act(async () => { await google().props.onClick(); });
    expect(browserAuth.signInWithOAuth).not.toHaveBeenCalled();
    expect(textOf(r.root)).toContain("tick the box");
    browserAuth.signInWithOAuth.mockResolvedValue({ error: null });
    act(() => { r.root.findAll((n) => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); });
    await act(async () => { await google().props.onClick(); });
    expect(browserAuth.signInWithOAuth).toHaveBeenCalledTimes(1);
  });
  it("both the login and the sign-up page offer it", () => {
    for (const mode of ["login", "signup"] as const) expect(renderToStaticMarkup(createElement(AuthForm, { mode, next: "/trips" }))).toContain("Continue with Google");
  });
});

describe("/auth/callback after Google", () => {
  const get = (q: string) => callbackGET(new NextRequest(`https://trailmate.app/auth/callback?${q}`));
  it("first time (no agreement yet) → the welcome step, keeping a safe next", async () => {
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: google() }, error: null });
    expect((await get("code=1&next=%2Ftrips%2Fabc")).headers.get("location")).toBe("https://trailmate.app/welcome?next=%2Ftrips%2Fabc");
  });
  it("agreed before (or an email account) → straight to next", async () => {
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: google({ accepted_terms_version: LEGAL_VERSION }) }, error: null });
    expect((await get("code=1&next=%2Ftrips")).headers.get("location")).toBe("https://trailmate.app/trips");
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: emailUser() }, error: null });
    expect((await get("code=1&next=%2Fdashboard")).headers.get("location")).toBe("https://trailmate.app/dashboard");
  });
  it("an unsafe next never leaves the site", async () => {
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ data: { user: google() }, error: null });
    expect((await get("code=1&next=%2F%2Fevil.com")).headers.get("location")).toBe("https://trailmate.app/welcome?next=%2Ftrips");
  });
});

describe("proxy: the welcome step cannot be skipped by typing a URL", () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"; });
  const run = (path: string) => updateSession(new NextRequest(`https://trailmate.app${path}`));
  it("Google user who hasn't agreed → /welcome with where they were going", async () => {
    proxyClaims.current = { sub: "u1", ...google() };
    expect((await run("/trips/abc?tab=1")).headers.get("location")).toBe("https://trailmate.app/welcome?next=%2Ftrips%2Fabc%3Ftab%3D1");
  });
  it("…but the welcome step, the Terms, auth routes and API calls are not redirected", async () => {
    proxyClaims.current = { sub: "u1", ...google() };
    for (const p of ["/welcome?next=%2Ftrips", "/terms", "/privacy", "/auth/callback?code=1", "/api/places"]) expect((await run(p)).headers.get("location"), p).toBeNull();
  });
  it("email users (and Google users who agreed) are never touched", async () => {
    proxyClaims.current = { sub: "u2", ...emailUser() };
    expect((await run("/trips")).headers.get("location")).toBeNull();
    proxyClaims.current = { sub: "u3", ...google({ accepted_terms_version: LEGAL_VERSION }) };
    expect((await run("/trips")).headers.get("location")).toBeNull();
  });
});

describe("the welcome step", () => {
  let r: TestRenderer.ReactTestRenderer;
  beforeEach(() => { browserAuth.updateUser.mockReset(); browserAuth.refreshSession.mockClear(); router.replace.mockClear(); });
  afterEach(() => act(() => r?.unmount()));
  const textOf = (n: TestRenderer.ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
  const submit = () => act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });

  it("nothing is saved without the tick", async () => {
    act(() => { r = TestRenderer.create(createElement(WelcomeForm, { next: "/trips", initialName: "Bhanu Prasad", email: "b@gmail.com" })); });
    expect(r.root.findAll((n) => n.type === "input" && n.props.value === "Bhanu Prasad")).toHaveLength(1); // the name from Google
    await submit();
    expect(browserAuth.updateUser).not.toHaveBeenCalled();
    expect(textOf(r.root)).toContain("tick the box");
  });
  it("with the tick: saves name + agreement like email sign-up, refreshes the login token, goes on", async () => {
    browserAuth.updateUser.mockResolvedValue({ error: null });
    act(() => { r = TestRenderer.create(createElement(WelcomeForm, { next: "/trips/abc", initialName: "Bhanu", email: null })); });
    act(() => { r.root.findAll((n) => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); });
    await submit();
    const data = browserAuth.updateUser.mock.calls[0][0].data;
    expect(data).toMatchObject({ display_name: "Bhanu", accepted_terms_version: LEGAL_VERSION });
    expect(typeof data.accepted_terms_at).toBe("string");
    expect(browserAuth.refreshSession).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/trips/abc");
  });
  it("the page: no session → log in; already agreed → straight on; otherwise the form", async () => {
    const open = async (user: unknown, next = "/trips") => {
      serverAuth.getUser.mockResolvedValueOnce({ data: { user } });
      try { return renderToStaticMarkup(await WelcomePage({ searchParams: Promise.resolve({ next }) })); } catch (e) { return (e as Error).message; }
    };
    expect(await open(null)).toBe("REDIRECT:/login?next=%2Ftrips");
    expect(await open({ ...emailUser(), email: "a@b.in" }, "/dashboard")).toBe("REDIRECT:/dashboard");
    expect(await open({ ...google({ full_name: "Bhanu" }), email: "b@gmail.com" })).toContain("One more step");
    expect(await open({ ...google(), email: "b@gmail.com" }, "//evil.com")).toContain("One more step");
  });
});
