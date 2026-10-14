import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_MAX_AGE_MS, applyQueued, dequeue, enqueue, parseQueue, sendStatus, type QueuedVisit } from "@/lib/client/visit-queue";
import { useVisits } from "@/lib/client/use-visits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = 1_800_000_000_000;
const q = (placeId: string, status: QueuedVisit["status"] = "done", at = T0): QueuedVisit => ({ placeId, status, at });

describe("the queue: what the phone remembers while it has no signal", () => {
  it("the newest answer for a stop replaces an older one (done, then undo, is just 'planned')", () => {
    const a = enqueue([], q("p1", "done", 1)); const b = enqueue(a, q("p1", "planned", 2));
    expect(b).toEqual([q("p1", "planned", 2)]);
    expect(enqueue(b, q("p2")).map((x) => x.placeId)).toEqual(["p1", "p2"]);
  });
  it("removing an answer that was sent leaves the others, and a newer answer for the same stop is not removed by an old send", () => {
    const items = [q("p1", "done", 5), q("p2", "skipped", 6)];
    expect(dequeue(items, "p1").map((x) => x.placeId)).toEqual(["p2"]);
    expect(dequeue(items, "p1", 4)).toHaveLength(2); // a different (older) answer: keep ours
  });
  it("shows the traveller's answers on top of the trip's stops before the server has heard them", () => {
    const places = [{ id: "p1", status: "planned" as string | null }, { id: "p2", status: "planned" }];
    const out = applyQueued(places, [q("p1", "done")]);
    expect(out.map((p) => p.status)).toEqual(["done", "planned"]);
    expect(places[0].status).toBe("planned"); // not mutated
    expect(applyQueued(places, [])).toBe(places);
  });
  it("drops answers older than a week and damaged entries, and never throws on junk", () => {
    const raw = JSON.stringify({ items: [q("old", "done", T0 - QUEUE_MAX_AGE_MS - 1), q("new", "done", T0 - 1000), { placeId: "", status: "done", at: T0 }, { placeId: "x", status: "weird", at: T0 }, null, 5] });
    expect(parseQueue(raw, T0).map((x) => x.placeId)).toEqual(["new"]);
    for (const j of [null, "", "{", "[]", "null", '{"items":5}']) expect(() => parseQueue(j, T0)).not.toThrow();
    expect(parseQueue("{", T0)).toEqual([]);
  });
});

describe("sending: which failures are worth retrying", () => {
  const send = (status: number | Error) => sendStatus("p1", "done", (async () => { if (status instanceof Error) throw status; return { ok: status < 400, status }; }) as unknown as typeof fetch);
  it("a saved answer is 'ok'", async () => { expect(await send(200)).toBe("ok"); });
  it("no network, a server error, too many requests or an expired sign-in are 'retry': the answer is kept", async () => {
    expect(await send(new TypeError("Failed to fetch"))).toBe("retry");
    for (const s of [500, 502, 503, 429, 408, 401]) expect(await send(s)).toBe("retry");
  });
  it("a refusal (stop removed, not allowed, bad data) is 'failed': it is dropped and reported", async () => { for (const s of [400, 403, 404, 409]) expect(await send(s)).toBe("failed"); });
  it("it sends exactly one PATCH of the status to that stop", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendStatus("abc", "skipped", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("/api/places/abc", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "skipped" }) }));
  });
});

describe("useVisits: works with no signal, and catches up when it returns", () => {
  let store: Record<string, string>; let online: boolean; let serverStatus: number; let sent: { id: string; status: string }[]; let winListeners: Record<string, (() => void)[]>;
  beforeEach(() => {
    store = {}; online = true; serverStatus = 200; sent = []; winListeners = {};
    vi.useFakeTimers(); vi.setSystemTime(T0);
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
      addEventListener: (n: string, f: () => void) => { (winListeners[n] ??= []).push(f); }, removeEventListener: (n: string, f: () => void) => { winListeners[n] = (winListeners[n] ?? []).filter((x) => x !== f); },
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i), setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (i: number) => clearInterval(i),
    });
    vi.stubGlobal("navigator", { get onLine() { return online; } });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { sent.push({ id: url.split("/").pop() as string, status: JSON.parse(String(init.body)).status }); if (serverStatus === -1) throw new TypeError("Failed to fetch"); return { ok: serverStatus < 400, status: serverStatus }; }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  let api: ReturnType<typeof useVisits>; let synced: number; let r: TestRenderer.ReactTestRenderer;
  const Probe = () => { api = useVisits("trip1", () => { synced++; }, () => T0); return null; };
  const mount = async () => { synced = 0; await act(async () => { r = TestRenderer.create(createElement(Probe)); }); };
  afterEach(() => { act(() => r?.unmount()); });

  it("online: the answer is sent at once, the server is told to refresh, and nothing stays queued", async () => {
    await mount();
    let res: string | undefined; await act(async () => { res = await api.mark("p1", "done", "Fort"); });
    expect(res).toBe("saved"); expect(sent).toEqual([{ id: "p1", status: "done" }]); expect(api.queued).toEqual([]); expect(synced).toBe(1);
  });
  it("OFFLINE: nothing is sent, the answer is kept on the phone and shown at once", async () => {
    online = false; await mount();
    let res: string | undefined; await act(async () => { res = await api.mark("p1", "done", "Fort"); });
    expect(res).toBe("queued"); expect(sent).toEqual([]); expect(api.queued.map((x) => `${x.placeId}:${x.status}`)).toEqual(["p1:done"]);
    expect(JSON.parse(store["tm:visits:trip1"]).items).toHaveLength(1); // survives a reload
  });
  it("a network failure mid-send is treated like being offline: kept, not lost", async () => {
    serverStatus = -1; await mount();
    let res: string | undefined; await act(async () => { res = await api.mark("p1", "done"); });
    expect(res).toBe("queued"); expect(api.queued).toHaveLength(1); expect(synced).toBe(0);
  });
  it("when the connection returns, everything waiting is sent in order and the page is refreshed", async () => {
    online = false; await mount();
    await act(async () => { await api.mark("p1", "done"); await api.mark("p2", "skipped"); });
    expect(sent).toEqual([]); online = true;
    await act(async () => { winListeners.online?.forEach((f) => f()); await vi.advanceTimersByTimeAsync(10); });
    expect(sent).toEqual([{ id: "p1", status: "done" }, { id: "p2", status: "skipped" }]); expect(api.queued).toEqual([]); expect(synced).toBe(1);
  });
  it("answers waiting from before a reload are sent on the next visit", async () => {
    store["tm:visits:trip1"] = JSON.stringify({ items: [q("p9", "done", T0 - 1000)] });
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(sent).toEqual([{ id: "p9", status: "done" }]); expect(api.queued).toEqual([]);
  });
  it("still offline on retry: keeps the rest and does not hammer the server", async () => {
    online = false; await mount(); await act(async () => { await api.mark("p1", "done"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 20_000); });
    expect(sent).toEqual([]); expect(api.queued).toHaveLength(1);
  });
  it("a refusal drops the answer and says why, instead of retrying forever", async () => {
    serverStatus = 404; await mount();
    await act(async () => { await api.mark("p1", "done", "Bhongir Fort"); });
    expect(api.queued).toEqual([]); expect(api.failed).toContain("Bhongir Fort"); expect(api.failed).toMatch(/removed|may not/);
  });
  it("undo offline: 'done' then 'planned' leaves a single answer, 'planned'", async () => {
    online = false; await mount();
    await act(async () => { await api.mark("p1", "done"); await api.mark("p1", "planned"); });
    expect(api.queued.map((x) => x.status)).toEqual(["planned"]);
  });
});
