import { createElement, act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/lib/client/use-hide-on-scroll", () => ({ useHideOnScroll: () => false }));
import { AppNav } from "@/components/shell/AppNav";
import { Logo } from "@/components/Logo";
import { HERO_PHOTO, MobileBackdrop } from "@/components/shell/MobileBackdrop";

const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(""));
const TRIP = "11111111-1111-4111-8111-111111111111";
const mount = async () => { let r!: TestRenderer.ReactTestRenderer; await act(async () => { r = TestRenderer.create(createElement(AppNav, { trips: [{ id: TRIP, name: "T", state: "active" }], userInitial: "G", signOutAction: async () => {} })); }); return r; };
const header = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "header")[0];
const bar = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "nav" && n.props["data-mobile-nav"] !== undefined)[0];
const search = (r: TestRenderer.ReactTestRenderer) => r.root.findAll((n) => n.type === "a" && n.props.href === "/explore" && String(n.props["aria-label"]).startsWith("Search"))[0];
beforeEach(() => { pathname = "/dashboard"; });

describe("phone header: the brand, an avatar and a search pill", () => {
  it("is for phones only and is not a solid sticky bar any more (it sits on the scene and scrolls away)", async () => {
    const r = await mount(); const c = String(header(r).props.className);
    expect(c).toContain("md:hidden"); expect(c).not.toContain("sticky"); expect(c).not.toContain("bg-pine"); expect(c).toContain("env(safe-area-inset-top)");
  });
  it("shows TrailMate with 'Plan · Ride · Explore' beneath, linking home", async () => {
    const r = await mount(); const t = text(header(r));
    expect(t).toContain("TrailMate"); expect(t).toContain("Plan"); expect(t).toContain("Ride"); expect(t).toContain("Explore");
    expect(r.root.findAll((n) => n.type === "a" && n.props.href === "/dashboard" && n.props["aria-label"] === "Trailmate dashboard").length).toBeGreaterThan(0);
  });
  it("has a 44 px avatar link to the profile with the person's initial", async () => {
    const a = (await mount()).root.findAll((n) => n.type === "a" && n.props["aria-label"] === "Your profile" && String(n.props.className).includes("h-11"))[0];
    expect(a).toBeTruthy(); expect(text(a)).toBe("G"); expect(a.props.href).toBe("/profile");
  });
  it("has a search pill that goes to Explore (where searching lives), with the invitation text, a clear label and a tall tap target", async () => {
    const s = search(await mount());
    expect(s).toBeTruthy(); expect(text(s)).toContain("Search destinations, plan your next ride…"); expect(String(s.props.className)).toContain("min-h-12"); expect(String(s.props.className)).toContain("tm-glass");
  });
  it("the pill is on the live trip page (as in the design), and on ordinary pages", async () => {
    for (const p of ["/dashboard", "/explore", `/trips/${TRIP}`, `/trips/${TRIP}/live`]) { pathname = p; expect(search(await mount())).toBeTruthy(); }
  });
  it("but not on the live map, which needs every pixel", async () => {
    pathname = `/trips/${TRIP}/map`; expect(search(await mount())).toBeUndefined();
    pathname = `/trips/${TRIP}/map/`; expect(search(await mount())).toBeUndefined();
  });
});

describe("floating glass bottom navigation", () => {
  it("floats inset from the edges and above the phone's home bar, as glass with rounded corners, on phones only", async () => {
    const c = String(bar(await mount()).props.className);
    for (const k of ["fixed", "inset-x-2", "env(safe-area-inset-bottom)", "tm-glass", "rounded-[1.75rem]", "md:hidden", "z-40"]) expect(c).toContain(k);
  });
  it("keeps the same five destinations, with the same links", async () => {
    pathname = `/trips/${TRIP}/live`;
    const r = await mount(); const links = bar(r).findAll((n) => n.type === "a").map((a) => [text(a).trim(), a.props.href]);
    expect(links).toEqual([["Discover", "/discover"], ["Trips", "/trips"], ["Live", `/trips/${TRIP}/live`], ["Map", `/trips/${TRIP}/map`]]);
    expect(text(bar(r))).toContain("More");
  });
  it("the current tab is marigold with a glowing underline and aria-current; the others are quiet with none", async () => {
    pathname = `/trips/${TRIP}/live`;
    const r = await mount(); const items = bar(r).findAll((n) => n.type === "a");
    const active = items.filter((a) => a.props["aria-current"] === "page"); expect(active).toHaveLength(1); expect(text(active[0])).toContain("Live");
    expect(String(active[0].props.className)).toContain("text-marigold");
    expect(bar(r).findAll((n) => n.props["data-glow"] === true)).toHaveLength(1);
    for (const a of items.filter((x) => x !== active[0])) { expect(String(a.props.className)).toContain("text-white/70"); expect(a.props["aria-current"]).toBeUndefined(); }
  });
  it("gives no tab a glow when you are on a page that is none of them", async () => {
    pathname = "/profile"; expect(bar(await mount()).findAll((n) => n.props["data-glow"] === true)).toHaveLength(0);
  });
  it("every destination is a 64 px tall target (well over the 44 px minimum)", async () => {
    const r = await mount();
    for (const el of [...bar(r).findAll((n) => n.type === "a"), ...bar(r).findAll((n) => n.type === "button")]) expect(String(el.props.className)).toContain("min-h-16");
  });
  it("the More menu opens as glass too", async () => {
    vi.stubGlobal("document", { addEventListener: () => undefined, removeEventListener: () => undefined });
    const r = await mount(); await act(async () => { r.root.findAll((n) => n.type === "button" && n.props["aria-haspopup"] === "dialog")[0].props.onClick(); });
    const sheet = r.root.findAll((n) => n.props.role === "dialog")[0];
    expect(sheet.findAll((n) => typeof n.props.className === "string" && n.props.className.includes("tm-glass") && n.props.className.includes("rounded-t-3xl"))).toHaveLength(1);
    vi.unstubAllGlobals();
  });
  it("the desktop sidebar is untouched: still a solid pine sidebar shown from 768 px up", async () => {
    const aside = (await mount()).root.findAll((n) => n.type === "aside")[0];
    expect(String(aside.props.className)).toContain("hidden"); expect(String(aside.props.className)).toContain("md:flex"); expect(String(aside.props.className)).toContain("bg-pine");
  });
});

describe("the logo", () => {
  it("is unchanged by default (the desktop sidebar and the landing page still say Trailmate)", () => {
    const html = renderToStaticMarkup(createElement(Logo)); expect(html).toContain("Trailmate"); expect(html).not.toContain("Plan");
  });
  it("the phone version names the three things the app is for, readably for screen readers", () => {
    const html = renderToStaticMarkup(createElement(Logo, { tagline: true }));
    expect(html).toContain("TrailMate"); expect(html).toContain("Plan"); expect(html).toContain("Explore");
    expect(html).toContain('aria-hidden="true"'); expect(html).toContain("sr-only"); // the dots are decoration; a screen reader gets commas
  });
});

describe("the scene behind the app", () => {
  const html = renderToStaticMarkup(createElement(MobileBackdrop));
  it("is decoration only: hidden from screen readers, never catches a tap, behind everything, and phones only", () => {
    for (const k of ['aria-hidden="true"', "pointer-events-none", "fixed", "-z-10", "md:hidden"]) expect(html).toContain(k);
  });
  it("is a real photograph, self-hosted and optimised by next/image, with no outside address", () => {
    expect(HERO_PHOTO).toBe("/brand/mobile-hero.webp");
    expect(html).toContain("<img"); expect(html).toContain("/_next/image?url="); expect(html).toContain("mobile-hero"); expect(html).toContain('alt=""');
    expect(html).not.toMatch(/src="https?:\/\//); expect(html).not.toContain("url(http");
  });
  it("fades into the dark green the cards sit on, so text stays readable over any part of the photo", () => { expect(html).toContain("linear-gradient(180deg"); expect(html).toContain("#06201c 72%"); });
  it("has nothing that moves or filters (cheap to scroll over on a low-end phone)", () => { expect(html).not.toMatch(/<animate|<filter|feGaussianBlur|animation/); });
  it("is mounted once, for the whole app, before the page content", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("<MobileBackdrop />"); expect(layout.indexOf("<MobileBackdrop />")).toBeLessThan(layout.indexOf("{children}"));
  });
  it("the phone's address bar takes the forest green; the light theme keeps its own", () => {
    const layout = readFileSync("app/layout.tsx", "utf8"); expect(layout).toContain('media: "(max-width: 767px)", color: "#06201c"'); expect(layout).toContain('color: "#0b3d3a"');
  });
});

