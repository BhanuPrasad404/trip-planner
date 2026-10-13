import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAction, type ActionResult } from "@/lib/client/use-action";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api!: ReturnType<typeof useAction<[string], string>>;
let fn: (s: string) => Promise<string>;
function Harness() {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  api = useAction((s: string) => fn(s));
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
const mount = async () => { await act(async () => { renderer = TestRenderer.create(createElement(Harness)); }); };
afterEach(() => { act(() => renderer?.unmount()); });

const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

describe("useAction — immediate, honest feedback for one async action", () => {
  it("is pending from the click until the REAL operation finishes (not before, not after)", async () => {
    const d = deferred<string>(); fn = () => d.promise;
    await mount();
    expect(api.pending).toBe(false);
    let result!: Promise<ActionResult<string>>;
    await act(async () => { result = api.run("x"); });
    expect(api.pending).toBe(true);                 // acknowledged at once, while the server is still working
    await act(async () => { d.resolve("saved"); await result; });
    expect(api.pending).toBe(false);
    await expect(result).resolves.toEqual({ ok: true, value: "saved" });
  });

  it("a second click while running is ignored and returns the SAME operation (nothing is sent twice)", async () => {
    const d = deferred<string>(); const spy = vi.fn(() => d.promise); fn = spy;
    await mount();
    let a!: Promise<ActionResult<string>>, b!: Promise<ActionResult<string>>;
    await act(async () => { a = api.run("1"); b = api.run("2"); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await act(async () => { d.resolve("ok"); await a; });
    // after it finished, the next click is a new, real action
    const d2 = deferred<string>(); fn = spy.mockImplementation(() => d2.promise);
    await act(async () => { void api.run("3"); });
    expect(spy).toHaveBeenCalledTimes(2);
    await act(async () => { d2.resolve("ok"); await Promise.resolve(); });
  });

  it("a failure is reported as an error and a not-ok result — pending ends, and the caller's own state is untouched", async () => {
    fn = async () => { throw new Error("The server said no."); };
    await mount();
    let r!: ActionResult<string>;
    await act(async () => { r = await api.run("x"); });
    expect(r).toEqual({ ok: false, error: "The server said no." });
    expect(api.error).toBe("The server said no.");
    expect(api.pending).toBe(false);
  });

  it("a failure without a message gets a calm default, and retrying clears the old error", async () => {
    let fail = true;
    fn = async () => { if (fail) throw "boom"; return "fine"; };
    await mount();
    await act(async () => { await api.run("x"); });
    expect(api.error).toBe("Something went wrong. Please try again.");
    fail = false;
    await act(async () => { await api.run("x"); });
    expect(api.error).toBeNull();
  });

  it("a function that throws immediately (before any await) cannot leave the action stuck", async () => {
    let n = 0;
    fn = (() => { n++; throw new Error("sync failure"); }) as unknown as (s: string) => Promise<string>;
    await mount();
    await act(async () => { await api.run("x"); });
    expect(api.pending).toBe(false);
    await act(async () => { await api.run("x"); });
    expect(n).toBe(2); // not blocked by the earlier failure
  });

  it("finishing after the component is gone is harmless", async () => {
    const d = deferred<string>(); fn = () => d.promise;
    await mount();
    let r!: Promise<ActionResult<string>>;
    await act(async () => { r = api.run("x"); });
    act(() => renderer.unmount());
    d.resolve("late");
    await expect(r).resolves.toEqual({ ok: true, value: "late" });
  });
});
