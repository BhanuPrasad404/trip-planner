import { describe, expect, it, vi } from "vitest";
import { createWikimediaClient, isAllowedWikimediaUrl } from "@/lib/place-photos/wikimedia";

const URL_OK = "https://en.wikipedia.org/w/api.php?action=query";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function rig(handler: (n: number, url: string, init?: RequestInit) => Response | Promise<Response>, over: Parameters<typeof createWikimediaClient>[0] = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const calls: { url: string; init?: RequestInit; at: number }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init, at: t }); return handler(calls.length, String(url), init); });
  const client = createWikimediaClient({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, random: () => 1, userAgent: () => "Test/1.0 (test@example.com)", ...over });
  return { client, sleeps, calls, fetchImpl, advance: (ms: number) => { t += ms; } };
}

describe("isAllowedWikimediaUrl: outbound hosts are allow-listed (no SSRF)", () => {
  it.each([
    ["https://en.wikipedia.org/w/api.php", true], ["https://commons.wikimedia.org/w/api.php?x=1", true], ["https://www.wikidata.org/w/api.php", true],
    ["http://en.wikipedia.org/w/api.php", false], ["https://evil.example/w/api.php", false], ["https://en.wikipedia.org.evil.example/x", false],
    ["https://en.wikipedia.org@evil.example/x", false], ["https://user:pw@en.wikipedia.org/x", false], ["https://en.wikipedia.org:8443/x", false],
    ["http://169.254.169.254/latest/meta-data", false], ["not a url", false], ["https://de.wikipedia.org/w/api.php", false],
  ])("%s -> %s", (u, ok) => expect(isAllowedWikimediaUrl(u)).toBe(ok));

  it("never even calls fetch for a URL that is not allowed", async () => {
    const r = rig(() => json({}));
    expect(await r.client.getJson("https://evil.example/x")).toBeNull();
    expect(r.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getJson", () => {
  it("returns the parsed JSON and identifies itself with the configured User-Agent", async () => {
    const r = rig(() => json({ hello: "world" }));
    expect(await r.client.getJson(URL_OK)).toEqual({ hello: "world" });
    expect((r.calls[0].init?.headers as Record<string, string>)["User-Agent"]).toBe("Test/1.0 (test@example.com)");
    expect(r.client.stats()).toMatchObject({ calls: 1, ok: 1, failures: 0 });
  });
  it("retries a 429 and succeeds, waiting as long as the server asked (capped)", async () => {
    const r = rig((n) => (n === 1 ? json({}, 429, { "retry-after": "2" }) : json({ ok: 1 })));
    expect(await r.client.getJson(URL_OK)).toEqual({ ok: 1 });
    expect(r.sleeps).toContain(2000);
    expect(r.client.stats()).toMatchObject({ retries: 1, rateLimited: 1, failures: 0 });
    const long = rig((n) => (n === 1 ? json({}, 429, { "retry-after": "600" }) : json({ ok: 1 })));
    await long.client.getJson(URL_OK);
    expect(Math.max(...long.sleeps)).toBeLessThanOrEqual(5000); // a page is never stalled for ten minutes
  });
  it("backs off exponentially (with jitter) on 5xx and network errors, then gives up with null", async () => {
    const r = rig(() => { throw new Error("offline"); });
    expect(await r.client.getJson(URL_OK)).toBeNull();
    expect(r.fetchImpl).toHaveBeenCalledTimes(3); // 1 try + 2 retries
    expect(r.client.stats()).toMatchObject({ retries: 2, failures: 1 });
    const waits = r.sleeps.filter((s) => s >= 200);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });
  it("does not retry what cannot be fixed by retrying (403, 404) or an unreadable body", async () => {
    for (const handler of [() => json({}, 403), () => json({}, 404), () => new Response("<html>", { status: 200 })]) {
      const r = rig(handler);
      expect(await r.client.getJson(URL_OK)).toBeNull();
      expect(r.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe("politeness: spacing and concurrency", () => {
  it("never has more than maxConcurrent requests in flight", async () => {
    let inFlight = 0, peak = 0;
    const r = rig(async () => { inFlight++; peak = Math.max(peak, inFlight); await Promise.resolve(); await Promise.resolve(); inFlight--; return json({}); }, { maxConcurrent: 2, minGapMs: 0 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => r.client.getJson(`${URL_OK}&i=${i}`)));
    expect(peak).toBeLessThanOrEqual(2);
    expect(r.fetchImpl).toHaveBeenCalledTimes(10);
  });
  it("spaces request starts by at least minGapMs instead of firing a burst", async () => {
    const r = rig(() => json({}), { maxConcurrent: 1, minGapMs: 150 });
    for (let i = 0; i < 4; i++) await r.client.getJson(`${URL_OK}&i=${i}`);
    const gaps = r.calls.slice(1).map((c, i) => c.at - r.calls[i].at);
    expect(gaps.every((g) => g >= 150)).toBe(true);
  });
});

describe("circuit breaker", () => {
  it("opens after repeated failed calls, then answers null instantly without calling Wikimedia", async () => {
    const r = rig(() => json({}, 503), { breakerThreshold: 3, maxRetries: 0, breakerCooldownMs: 60_000 });
    for (let i = 0; i < 3; i++) await r.client.getJson(URL_OK);
    expect(r.client.breakerOpen()).toBe(true);
    const before = r.fetchImpl.mock.calls.length;
    expect(await r.client.getJson(URL_OK)).toBeNull();
    expect(r.fetchImpl.mock.calls.length).toBe(before);
    expect(r.client.stats()).toMatchObject({ breakerTrips: 1, skippedByBreaker: 1 });
  });
  it("closes again after the cooldown, and one success resets the failure count", async () => {
    let bad = true;
    const r = rig(() => (bad ? json({}, 503) : json({ fine: true })), { breakerThreshold: 2, maxRetries: 0, breakerCooldownMs: 60_000 });
    await r.client.getJson(URL_OK); await r.client.getJson(URL_OK);
    expect(r.client.breakerOpen()).toBe(true);
    r.advance(61_000);
    bad = false;
    expect(await r.client.getJson(URL_OK)).toEqual({ fine: true });
    expect(r.client.breakerOpen()).toBe(false);
    bad = true;
    await r.client.getJson(URL_OK); // one failure after a success must not trip a threshold of 2
    expect(r.client.breakerOpen()).toBe(false);
  });
});
