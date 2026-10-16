import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const browserAuth = {
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
};
const serverAuth = { verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: browserAuth }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: serverAuth }) }));

import { AuthForm } from "@/components/AuthForm";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { GET as confirmGET } from "@/app/auth/confirm/route";
import { GET as callbackGET } from "@/app/auth/callback/route";
import {
  RESET_EXPIRED_MESSAGE, RESET_OFFLINE_MESSAGE, RESET_SENT_MESSAGE,
  looksLikeEmail, passwordUpdateError, resetRequestOutcome, validateNewPassword,
} from "@/lib/password-reset";

const textOf = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());
const typeInto = (r: TestRenderer.ReactTestRenderer, index: number, value: string) =>
  act(() => { r.root.findAllByType("input")[index].props.onChange({ target: { value } }); });
const submit = (r: TestRenderer.ReactTestRenderer) =>
  act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault() {} }); });

describe("resetRequestOutcome never reveals whether an email has an account", () => {
  it.each([
    ["sent", null],
    ["unknown email (Supabase still answers OK)", null],
    ["rate limit", { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "For security purposes…" }],
    ["user not found style error", { name: "AuthApiError", status: 400, code: "user_not_found", message: "User not found" }],
    ["server error", { name: "AuthApiError", status: 500, message: "boom" }],
  ])("%s → the same neutral message", (_label, error) => {
    expect(resetRequestOutcome(error)).toEqual({ kind: "sent", message: RESET_SENT_MESSAGE });
  });
  it("only a request that never reached the server says so", () => {
    expect(resetRequestOutcome(null, true).message).toBe(RESET_OFFLINE_MESSAGE);
    expect(resetRequestOutcome({ name: "AuthRetryableFetchError", status: 0 }).kind).toBe("offline");
  });
  it("the neutral message does not say the account exists", () => {
    expect(RESET_SENT_MESSAGE).toMatch(/^If an account exists/);
  });
});

describe("validateNewPassword / passwordUpdateError", () => {
  it("checks length and that both boxes match", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least 8/);
    expect(validateNewPassword("longenough1", "longenough2")).toMatch(/don't match/);
    expect(validateNewPassword("longenough1", "longenough1")).toBeNull();
  });
  it("turns Supabase codes into plain words", () => {
    expect(passwordUpdateError({ code: "same_password" })).toMatch(/current password/);
    expect(passwordUpdateError({ code: "weak_password" })).toMatch(/too easy/);
    expect(passwordUpdateError({ code: "session_not_found" })).toBe(RESET_EXPIRED_MESSAGE);
    expect(passwordUpdateError({ status: 0 })).toBe(RESET_OFFLINE_MESSAGE);
    expect(passwordUpdateError({ code: "x", message: "raw internal text" })).not.toContain("raw internal text");
  });
  it("looksLikeEmail", () => {
    expect(looksLikeEmail(" a@b.in ")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
  });
});

describe("login page", () => {
  it("shows Forgot password? on login only", () => {
    expect(renderToStaticMarkup(createElement(AuthForm, { mode: "login", next: "/trips" }))).toContain('href="/forgot-password"');
    expect(renderToStaticMarkup(createElement(AuthForm, { mode: "signup", next: "/trips" }))).not.toContain("/forgot-password");
  });
});

describe("ForgotPasswordForm", () => {
  let r: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "https://trailmate.app" } });
    browserAuth.resetPasswordForEmail.mockReset();
  });
  afterEach(() => { act(() => r?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  const mount = () => act(() => { r = TestRenderer.create(createElement(ForgotPasswordForm, {})); });

  it("known and unknown emails look identical to the person", async () => {
    const shown: string[] = [];
    for (const answer of [{ error: null }, { error: { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit" } }]) {
      browserAuth.resetPasswordForEmail.mockResolvedValueOnce(answer);
      mount(); typeInto(r, 0, "someone@example.in"); await submit(r);
      // Everything the person can read: the status box, any error box, and the button label.
      const status = r.root.findAll((n) => n.type === "p" && (n.props.role === "status" || n.props.role === "alert")).map((n) => JSON.stringify(n.children));
      const button = r.root.findAllByType("button").map((b) => JSON.stringify(b.children));
      shown.push(JSON.stringify({ status, button }));
      act(() => r.unmount());
    }
    expect(shown[0]).toContain("If an account exists");
    expect(shown[0]).toBe(shown[1]);
  });

  it("sends the link back to our callback with the reset page as next, then waits 60 s", async () => {
    browserAuth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    mount(); typeInto(r, 0, "  me@example.in "); await submit(r);
    expect(browserAuth.resetPasswordForEmail).toHaveBeenCalledWith("me@example.in", { redirectTo: "https://trailmate.app/auth/callback?next=%2Freset-password" });
    const button = () => r.root.findAllByType("button").find((b) => b.props.type === "submit")!;
    expect(button().props.disabled).toBe(true);
    for (let i = 0; i < 61; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(button().props.disabled).toBe(false);
  });

  it("a bad email is caught before any request; a network failure says so", async () => {
    mount(); typeInto(r, 0, "not-an-email"); await submit(r);
    expect(browserAuth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(textOf(r)).toContain("Enter the email address");
    browserAuth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError("fetch failed"));
    typeInto(r, 0, "me@example.in"); await submit(r);
    expect(textOf(r)).toContain("Check your connection");
  });
});

describe("ResetPasswordForm", () => {
  let r: TestRenderer.ReactTestRenderer;
  beforeEach(() => { browserAuth.updateUser.mockReset(); browserAuth.signOut.mockClear(); });
  afterEach(() => act(() => r?.unmount()));
  const mount = (hasSession: boolean) => act(() => { r = TestRenderer.create(createElement(ResetPasswordForm, { hasSession })); });

  it("without a session shows the expired state with a way to get a new link", () => {
    mount(false);
    expect(textOf(r)).toContain("Link expired");
    expect(r.root.findAll((n) => n.props.href === "/forgot-password?expired=1").length).toBeGreaterThan(0);
  });

  it("mismatched passwords are refused locally", async () => {
    mount(true); typeInto(r, 0, "newpassword1"); typeInto(r, 1, "newpassword2"); await submit(r);
    expect(browserAuth.updateUser).not.toHaveBeenCalled();
    expect(textOf(r)).toContain("don't match");
  });

  it("success saves, logs out other devices, and says so", async () => {
    browserAuth.updateUser.mockResolvedValueOnce({ error: null });
    mount(true); typeInto(r, 0, "newpassword1"); typeInto(r, 1, "newpassword1"); await submit(r);
    expect(browserAuth.updateUser).toHaveBeenCalledWith({ password: "newpassword1" });
    expect(browserAuth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(textOf(r)).toContain("Password changed");
  });

  it("same password → clear message; expired session mid-way → expired state", async () => {
    browserAuth.updateUser.mockResolvedValueOnce({ error: { code: "same_password" } });
    mount(true); typeInto(r, 0, "newpassword1"); typeInto(r, 1, "newpassword1"); await submit(r);
    expect(textOf(r)).toContain("current password");
    browserAuth.updateUser.mockResolvedValueOnce({ error: { code: "session_not_found" } });
    await submit(r);
    expect(textOf(r)).toContain("Link expired");
  });
});

describe("/auth/confirm (token_hash links, any device)", () => {
  beforeEach(() => serverAuth.verifyOtp.mockReset());
  const get = (q: string) => confirmGET(new NextRequest(`https://trailmate.app/auth/confirm?${q}`));
  const loc = (res: Response) => res.headers.get("location");

  it("a valid recovery link lands on the reset page, even if next= says otherwise", async () => {
    serverAuth.verifyOtp.mockResolvedValueOnce({ error: null });
    const res = await get("token_hash=abc&type=recovery&next=https://evil.com");
    expect(serverAuth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" });
    expect(loc(res)).toBe("https://trailmate.app/reset-password");
  });
  it("an expired recovery link → request-a-new-link page", async () => {
    serverAuth.verifyOtp.mockResolvedValueOnce({ error: { code: "otp_expired" } });
    expect(loc(await get("token_hash=abc&type=recovery"))).toBe("https://trailmate.app/forgot-password?expired=1");
  });
  it("signup links keep a SAFE next, unknown types are refused without calling Supabase", async () => {
    serverAuth.verifyOtp.mockResolvedValueOnce({ error: null });
    expect(loc(await get("token_hash=abc&type=signup&next=//evil.com"))).toBe("https://trailmate.app/trips");
    expect(loc(await get("token_hash=abc&type=weird"))).toBe("https://trailmate.app/login?error=auth");
    expect(loc(await get("type=recovery"))).toBe("https://trailmate.app/forgot-password?expired=1");
    expect(serverAuth.verifyOtp).toHaveBeenCalledTimes(1);
  });
});

describe("/auth/callback (code links)", () => {
  beforeEach(() => serverAuth.exchangeCodeForSession.mockReset());
  const get = (q: string) => callbackGET(new NextRequest(`https://trailmate.app/auth/callback?${q}`));
  it("a good reset code lands on the reset page; a bad one asks for a new link", async () => {
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    expect((await get("code=1&next=%2Freset-password")).headers.get("location")).toBe("https://trailmate.app/reset-password");
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "bad" } });
    expect((await get("code=1&next=%2Freset-password")).headers.get("location")).toBe("https://trailmate.app/forgot-password?expired=1");
  });
  it("other failures keep the generic login error", async () => {
    serverAuth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "bad" } });
    expect((await get("code=1&next=%2Ftrips")).headers.get("location")).toBe("https://trailmate.app/login?error=auth");
  });
});
