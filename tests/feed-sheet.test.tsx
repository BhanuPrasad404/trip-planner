import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/feed/Sheet";

const sheet = (title: string, onClose: () => void) => createElement(Sheet, { title, onClose }, createElement("p", null, "body"));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A sheet without a browser: just enough of `document` to see what the sheet does to it.
type Handler = (e: { key: string; shiftKey?: boolean; preventDefault: () => void }) => void;
let handlers: Handler[]; let root: { style: Record<string, string>; clientWidth: number }; let doc: { activeElement: unknown; addEventListener: (t: string, h: Handler) => void; removeEventListener: (t: string, h: Handler) => void; documentElement: typeof root };
const box = (focusable: { focus: () => void; offsetParent: object }[] = []) => ({ focus: vi.fn(), querySelector: () => null, querySelectorAll: () => focusable });
beforeEach(() => {
  handlers = []; root = { style: { overflow: "", paddingRight: "" }, clientWidth: 1024 };
  doc = { activeElement: null, addEventListener: (t, h) => { if (t === "keydown") handlers.push(h); }, removeEventListener: (t, h) => { if (t === "keydown") handlers.splice(handlers.indexOf(h), 1); }, documentElement: root };
  vi.stubGlobal("document", doc); vi.stubGlobal("window", { innerWidth: 1024 });
});
const open: TestRenderer.ReactTestRenderer[] = [];
afterEach(async () => { for (const r of open.splice(0)) await act(async () => { try { r.unmount(); } catch { /* already closed */ } }); vi.unstubAllGlobals(); });   // every sheet closes, so the scroll lock count starts at zero again
const mount = async (node: ReturnType<typeof box>, onClose: () => void) => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(sheet("Comments", onClose), { createNodeMock: () => node }); });
  open.push(r);
  return r;
};

describe("sheet", () => {
  it("takes focus once, and keeps it when the page behind re-renders (typing in a comment box must not lose the cursor)", async () => {
    const node = box();
    const r = await mount(node, () => undefined);
    expect(node.focus).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) await act(async () => { r.update(sheet("Comments", () => undefined)); });   // a new close function every render, as parents do
    expect(node.focus).toHaveBeenCalledTimes(1);
    expect(handlers).toHaveLength(1);                                         // and no listener piles up
  });
  it("Escape calls the CURRENT close function", async () => {
    const first = vi.fn(), second = vi.fn();
    const r = await mount(box(), first);
    await act(async () => { r.update(sheet("x", second)); });
    handlers[0]({ key: "Escape", preventDefault: () => undefined });
    expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
  });
  it("the page behind cannot scroll while it is open, and can again after", async () => {
    const r = await mount(box(), () => undefined);
    expect(root.style.overflow).toBe("hidden");
    await act(async () => { r.unmount(); });
    expect(root.style.overflow).toBe("");
    expect(handlers).toHaveLength(0);
  });
  it("Tab stays inside: from the last control it goes to the first, and Shift+Tab the other way", async () => {
    const a = { focus: vi.fn(), offsetParent: {} }, z = { focus: vi.fn(), offsetParent: {} };
    await mount(box([a, z]), () => undefined);
    const stop = vi.fn();
    doc.activeElement = z; handlers[0]({ key: "Tab", preventDefault: stop });
    expect(a.focus).toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(1);
    doc.activeElement = a; handlers[0]({ key: "Tab", shiftKey: true, preventDefault: stop });
    expect(z.focus).toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(2);
    doc.activeElement = {}; handlers[0]({ key: "Tab", preventDefault: stop });          // somewhere in the middle: the browser moves on its own
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
