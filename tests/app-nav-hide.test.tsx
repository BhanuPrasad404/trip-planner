import { createElement, act, type ReactNode } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let pathname = "/discover"; let away = false; const calls: { enabled: boolean; key: string }[] = [];
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/lib/client/use-hide-on-scroll", () => ({ useHideOnScroll: (enabled: boolean, key: string) => { calls.push({ enabled, key }); return enabled && away; } }));
import { AppNav } from "@/components/shell/AppNav";

const mount = async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(createElement(AppNav, { trips: [{ id: "11111111-1111-4111-8111-111111111111", name: "T", state: "active" }], userInitial: "B", signOutAction: async () => {} })); });
  return r;
};
const bar = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "nav" && n.props["data-mobile-nav"] !== undefined)[0];
const SHOWN = "translate-y-0"; const HIDDEN = "translate-y-[calc(100%+1.5rem)]"; // the floating bar clears its own margin when it slides away

describe("bottom navigation: hides while reading down, never while driving", () => {
  beforeEach(() => { pathname = "/discover"; away = false; calls.length = 0; });
  afterEach(() => vi.unstubAllGlobals());

  it("is shown normally", async () => { const r = await mount(); expect(bar(r).props.className).toContain("translate-y-0"); expect(bar(r).props.className).not.toContain(HIDDEN); });
  it("slides away when the page has been read down", async () => {
    away = true; const r = await mount();
    expect(bar(r).props.className).toContain(HIDDEN); expect(bar(r).props["data-hidden"]).toBe(true);
  });
  it("animates, except for people who asked for less motion", async () => { const c = bar(await mount()).props.className; expect(c).toContain("transition-transform"); expect(c).toContain("motion-reduce:transition-none"); });
  it("a keyboard or screen-reader user who reaches the bar always sees it, and it may hide again after", async () => {
    away = true; const r = await mount(); expect(bar(r).props.className).toContain(HIDDEN);
    await act(async () => { bar(r).props.onFocus(); }); expect(bar(r).props.className).toContain("translate-y-0");
    await act(async () => { bar(r).props.onBlur(); }); expect(bar(r).props.className).toContain(HIDDEN);
  });
  it.each(["/trips/11111111-1111-4111-8111-111111111111/live", "/trips/11111111-1111-4111-8111-111111111111/map"])("is switched off on %s (a driver's controls never move)", async (p) => {
    pathname = p; away = true; const r = await mount();
    expect(calls.every((c) => c.enabled === false)).toBe(true); expect(bar(r).props.className).toContain("translate-y-0");
  });
  it("is switched on for reading pages, and told which page it is on (so a new page starts shown)", async () => {
    pathname = "/explore"; await mount(); expect(calls.at(-1)).toEqual({ enabled: true, key: "/explore" });
  });
  it("is switched off while the More menu is open", async () => {
    vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
    const r = await mount(); const more = r.root.findAll((n) => n.type === "button" && n.props["aria-haspopup"] === "dialog")[0];
    calls.length = 0; await act(async () => { more.props.onClick(); });
    expect(calls.at(-1)?.enabled).toBe(false);
  });
  it("only affects the phone bar (it is hidden on larger screens anyway)", async () => { expect(bar(await mount()).props.className).toContain("md:hidden"); });
});
