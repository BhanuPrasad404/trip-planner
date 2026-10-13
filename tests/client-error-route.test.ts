import { beforeEach, describe, expect, it, vi } from "vitest";
const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
import { POST } from "@/app/api/client-error/route";

let ipCounter = 0;
const send = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("https://trailmate.app/api/client-error", { method: "POST", headers: { host: "trailmate.app", "x-forwarded-for": `10.0.0.${++ipCounter}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
beforeEach(() => reportError.mockClear());

describe("POST /api/client-error", () => {
  it("accepts a valid report and forwards it, labelled as coming from the browser", async () => {
    const res = await send({ kind: "window.onerror", message: "x is undefined", path: "/trips/1/live" });
    expect(res.status).toBe(204);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportError.mock.calls[0] as [Error, { where: string; extra: { path: string } }];
    expect(err.name).toBe("Browser:window.onerror"); expect(err.message).toBe("x is undefined"); expect(ctx).toMatchObject({ where: "browser", extra: { path: "/trips/1/live" } });
  });
  it("refuses reports sent from another website", async () => {
    expect((await send({ kind: "k", message: "m" }, { origin: "https://evil.example" })).status).toBe(403);
    expect(reportError).not.toHaveBeenCalled();
  });
  it("accepts reports from our own site's Origin", async () => {
    expect((await send({ kind: "k", message: "m" }, { origin: "https://trailmate.app" })).status).toBe(204);
  });
  it("rejects malformed, oversized or empty bodies without reporting anything", async () => {
    expect((await send("not json")).status).toBe(400);
    expect((await send({ kind: "k" })).status).toBe(400);
    expect((await send({ kind: "k", message: "m".repeat(600) })).status).toBe(400);
    expect((await send({ kind: "k", message: "m" }, { "content-length": "99999" })).status).toBe(413);
    expect(reportError).not.toHaveBeenCalled();
  });
  it("a noisy browser is quietly ignored after 10 reports a minute (still 204, nothing forwarded)", async () => {
    const same = { host: "trailmate.app", "x-forwarded-for": "9.9.9.9" };
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await POST(new Request("https://trailmate.app/api/client-error", { method: "POST", headers: same, body: JSON.stringify({ kind: "k", message: `m${i}` }) }))).status);
    expect(codes.every((c) => c === 204)).toBe(true);
    expect(reportError).toHaveBeenCalledTimes(10);
  });
});
