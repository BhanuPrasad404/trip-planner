import { afterEach, describe, expect, it, vi } from "vitest";
const sendTestAlert = vi.fn(async () => ({ configured: true, delivered: true }));
vi.mock("@/lib/monitoring", () => ({ sendTestAlert: () => sendTestAlert() }));
import { POST } from "@/app/api/admin/alert-test/route";

const SECRET = "a-long-enough-secret-123";
const call = (secret?: string) => POST(new Request("http://x", { method: "POST", headers: secret ? { "x-ingest-secret": secret } : {} }));
afterEach(() => { vi.unstubAllEnvs(); sendTestAlert.mockClear(); sendTestAlert.mockResolvedValue({ configured: true, delivered: true }); });

describe("POST /api/admin/alert-test", () => {
  it("does not exist (404) when no admin secret is configured", async () => {
    vi.stubEnv("INGEST_SECRET", "");
    expect((await call("anything")).status).toBe(404);
    expect(sendTestAlert).not.toHaveBeenCalled();
  });
  it("401 with the wrong or a missing secret", async () => {
    vi.stubEnv("INGEST_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect(sendTestAlert).not.toHaveBeenCalled();
  });
  it("200 when the test message was delivered", async () => {
    vi.stubEnv("INGEST_SECRET", SECRET);
    const res = await call(SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true, delivered: true });
  });
  it("explains a missing webhook (400) and a failed delivery (502)", async () => {
    vi.stubEnv("INGEST_SECRET", SECRET);
    sendTestAlert.mockResolvedValue({ configured: false, delivered: false });
    const missing = await call(SECRET);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/ALERT_WEBHOOK_URL/);
    sendTestAlert.mockResolvedValue({ configured: true, delivered: false });
    expect((await call(SECRET)).status).toBe(502);
  });
});
