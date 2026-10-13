import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_LIMITS, createAlertGate, deliver, describeError, fingerprint, formatAlert, redact, reportError, sendTestAlert, webhookUrl } from "@/lib/monitoring";

describe("redact: nothing personal or secret leaves the server", () => {
  it("removes emails, tokens, keys and secrets from text", () => {
    const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
    const out = redact(`user ann@example.com sent Bearer abcdefghijklmnop12345 and ${jwt} to /x?access_token=SECRET123&ok=1 key sk-abcdefghijklmnopqrstuv0123 ${"a".repeat(40)}`);
    for (const leak of ["ann@example.com", "abcdefghijklmnop12345", jwt, "SECRET123", "sk-abcdefghijklmnopqrstuv0123", "a".repeat(40)]) expect(out).not.toContain(leak);
    expect(out).toContain("ok=1");
  });
  it("leaves ordinary text alone", () => {
    expect(redact("insert on places violates foreign key constraint")).toBe("insert on places violates foreign key constraint");
  });
});

describe("describeError and fingerprint", () => {
  it("copes with errors, strings and odd values", () => {
    expect(describeError(new TypeError("boom")).name).toBe("TypeError");
    expect(describeError("plain").message).toBe("plain");
    expect(describeError({ a: 1 }).message).toContain("a");
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(describeError(circular).message).toBe("(unreadable error)");
  });
  it("the same problem has the same fingerprint whatever ids or numbers it contains", () => {
    const a = fingerprint("api", { name: "Error", message: "row 12 of 9d5c2f3e-1111-4222-8333-444455556666 failed" });
    const b = fingerprint("api", { name: "Error", message: "row 99 of 11111111-2222-4333-8444-555566667777 failed" });
    expect(a).toBe(b);
    expect(fingerprint("api", { name: "Error", message: "other" })).not.toBe(a);
  });
});

describe("alert gate: no flood", () => {
  it("sends once, then treats repeats as duplicates until the window passes", () => {
    let t = 0;
    const gate = createAlertGate({ dedupeMs: 600_000, perHour: 20 }, () => t);
    expect(gate.check("a")).toBe("send");
    expect(gate.check("a")).toBe("duplicate");
    t += 599_000; expect(gate.check("a")).toBe("duplicate");
    t += 2_000;   expect(gate.check("a")).toBe("send");
  });
  it("caps the number of different alerts per hour, then recovers", () => {
    let t = 0;
    const gate = createAlertGate({ dedupeMs: 600_000, perHour: 3 }, () => t);
    expect(["a", "b", "c", "d"].map((k) => gate.check(k))).toEqual(["send", "send", "send", "capped"]);
    t += 3_600_001;
    expect(gate.check("e")).toBe("send");
  });
  it("uses the documented defaults", () => { expect(ALERT_LIMITS).toMatchObject({ dedupeMs: 600_000, perHour: 20 }); });
});

describe("formatAlert", () => {
  it("names the environment, the place and the commit, and contains no personal data", () => {
    const text = formatAlert({
      where: "api", error: { name: "Error", message: "failed for ann@example.com", stack: "Error: x\n at a (/app/a.ts:1)\n at b (/app/b.ts:2)" },
      extra: { route: "/api/places", missing: undefined }, env: { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abcdef1234567", VERCEL_REGION: "hnd1" },
    });
    expect(text).toContain("production"); expect(text).toContain("api: Error"); expect(text).toContain("route=/api/places"); expect(text).toContain("commit abcdef1"); expect(text).toContain("region hnd1");
    expect(text).not.toContain("ann@example.com"); expect(text).not.toContain("missing=");
  });
  it("never exceeds the length limit", () => {
    expect(formatAlert({ where: "x", error: { name: "E", message: "m".repeat(5000), stack: "s\n" + "l\n".repeat(5000) } }).length).toBeLessThanOrEqual(ALERT_LIMITS.maxChars);
  });
});

describe("webhookUrl", () => {
  it("accepts only an https address", () => {
    expect(webhookUrl({ ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" })).toBe("https://discord.com/api/webhooks/1/abc");
    expect(webhookUrl({ ALERT_WEBHOOK_URL: '"https://discord.com/api/webhooks/1/abc"' })).toBe("https://discord.com/api/webhooks/1/abc");
    for (const bad of ["", "http://insecure.example/x", "ftp://x", "not a url", undefined]) expect(webhookUrl({ ALERT_WEBHOOK_URL: bad })).toBeNull();
  });
});

describe("deliver", () => {
  it("posts both 'content' (Discord) and 'text' (Slack) as JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await deliver("https://x.example/hook", "hello", fetchImpl)).toBe(true);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ content: "hello", text: "hello" });
    expect(init.method).toBe("POST");
  });
  it("a failing or unreachable channel never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deliver("https://x.example/hook", "m", vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch)).toBe(false);
    expect(await deliver("https://x.example/hook", "m", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("reportError (end to end)", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it("without a webhook it only logs, and never throws", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    expect(() => reportError(new Error("quiet failure"), { where: "api" })).not.toThrow();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it("with a webhook it sends one cleaned message, and the same error again is not sent twice", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.example/hook");
    reportError(new Error("unique failure for ann@example.com #1"), { where: "api", extra: { route: "/x" } });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.text).not.toContain("ann@example.com");
    reportError(new Error("unique failure for bob@example.com #2"), { where: "api" }); // same fingerprint once emails and numbers are normalised
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("garbage input cannot break it", () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.example/hook");
    for (const v of [undefined, null, 0, {}, [], Symbol.iterator]) expect(() => reportError(v, { where: "x" })).not.toThrow();
  });
  it("the test message ignores the flood limits and reports honestly when not configured", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    expect(await sendTestAlert()).toEqual({ configured: false, delivered: false });
    vi.stubEnv("ALERT_WEBHOOK_URL", "https://discord.example/hook");
    expect(await sendTestAlert()).toEqual({ configured: true, delivered: true });
    expect(await sendTestAlert()).toEqual({ configured: true, delivered: true });
  });
});
