import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKDROP_COLORS } from "@/components/shell/MobileBackdrop";

// TrailMate's look is one white theme for every screen size, defined by tokens in app/globals.css. This checks what a person can feel
// without a screenshot: every text colour is readable on every surface it sits on (WCAG AA 4.5:1; focus rings 3:1), the phone layer only
// tunes touch behaviour, and nothing that moves or blurs is added to ordinary cards. (Seeing it on a real phone is still a manual check.)
const css = readFileSync("app/globals.css", "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const vars: Record<string, string> = {};
for (const m of root.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();

type RGBA = [number, number, number, number];
const parse = (v: string): RGBA => {
  const h = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  const m = /^rgba?\(([^)]+)\)$/.exec(v.trim());
  if (!m) throw new Error(`unreadable colour ${v}`);
  const p = m[1].split(",").map((x) => Number(x.trim()));
  return [p[0], p[1], p[2], p[3] ?? 1];
};
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = ([r, g, b]: RGBA) => { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const v = (name: string) => parse(vars[name]);
const WHITE = parse("#ffffff");
const black: RGBA = [0, 0, 0, 1];

describe("the white theme's tokens", () => {
  it("is a warm white page with white cards", () => {
    expect(vars["--background"]).toBe("#faf8f3"); expect(vars["--sky"]).toBe("#f5f2ea"); expect(vars["--line"]).toBe("#e5e0d4");
    expect(css).toContain("color-scheme: light;");
    expect(lum(v("--background"))).toBeGreaterThan(0.9);
  });
  it("keeps the brand colours (deep pine, trail teal, marigold, clay)", () => {
    expect(vars["--pine"]).toBe("#0b3d3a"); expect(vars["--teal"]).toBe("#1c7c6d"); expect(vars["--marigold"]).toBe("#e8a33d"); expect(vars["--clay"]).toBe("#c1542c");
  });
  it("has no dark phone theme any more: no dark colour scheme, glass tokens or cream text", () => {
    for (const gone of ["color-scheme: dark", "--tm-glass:", "tm-cream", "MOBILE THEME", ".text-pine { color"]) expect(css).not.toContain(gone);
  });
});

describe("every text colour is readable on every surface it can sit on (WCAG AA, 4.5:1)", () => {
  const surfaces: [string, RGBA][] = [["white card", WHITE], ["the page", v("--background")], ["a tinted block", v("--sky")]];
  for (const [token, label] of [["--ink", "body text"], ["--ink-soft", "soft text"], ["--ink-muted", "muted text"], ["--pine", "headings"]] as const) {
    for (const [name, bg] of surfaces) it(`${label} on ${name}`, () => expect(contrast(v(token), bg)).toBeGreaterThanOrEqual(4.5));
  }
  it("the text-safe colours on their own tints, and on white", () => {
    for (const [ink, tint] of [["--teal-ink", "--teal-light"], ["--clay-ink", "--clay-light"], ["--marigold-ink", "--marigold-light"]] as const) {
      expect(contrast(v(ink), v(tint)), `${ink} on ${tint}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v(ink), WHITE), `${ink} on white`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("buttons: deep green on marigold (and its hover and pressed colours); white on pine, on teal", () => {
    for (const bg of ["#e8a33d", "#f0b254", "#d9942d"]) expect(contrast(v("--pine"), parse(bg)), bg).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, v("--pine"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, v("--teal"))).toBeGreaterThanOrEqual(4.5);
  });
  it("the page title on the photo at the top of the page, even if the photo's darkest possible pixel were under it", () => {
    const [r, g, b] = BACKDROP_COLORS.wash.split(",").map(Number);
    const worst = over([r, g, b, BACKDROP_COLORS.topWash], black);
    for (const token of ["--ink", "--ink-muted", "--pine", "--teal-ink"]) expect(contrast(v(token), worst), token).toBeGreaterThanOrEqual(4.5);
  });
  it("small marigold kickers: the text-safe marigold on the white app, bright marigold kept on the deep-green surfaces", () => {
    expect(css).toContain(".text-marigold.uppercase { color: var(--marigold-ink); }");
    expect(css).toMatch(/\[class\*="bg-pine"\][^{]*\.text-marigold\.uppercase \{ color: var\(--marigold\); \}/);
    expect(contrast(v("--marigold"), v("--pine"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v("--marigold"), WHITE)).toBeLessThan(3);   // why the kicker needed it
  });
  it("keyboard focus rings are visible (3:1): teal on the white app, marigold on the deep-green surfaces", () => {
    expect(contrast(v("--teal"), WHITE)).toBeGreaterThanOrEqual(3); expect(contrast(v("--teal"), v("--sky"))).toBeGreaterThanOrEqual(3);
    expect(contrast(v("--marigold"), v("--pine"))).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--teal\)/);
    expect(css).toMatch(/\.bg-pine[^{]*:focus-visible \{ outline-color: var\(--marigold\)/);
  });
});

describe("phones", () => {
  const phone = css.slice(css.indexOf("PHONES (below 768 px)"));
  const block = phone.slice(phone.indexOf("@media (max-width: 767px) {"), phone.indexOf(".tm-glass {"));
  it("the phone layer only tunes touch behaviour: 16 px fields (no zoom on tap) and room above the floating bar", () => {
    expect(block).toContain("font-size: max(16px, 1em)"); expect(block).toContain("scroll-padding-bottom");
    expect(block).not.toMatch(/background|color:/);
  });
  it("the floating surface is white with a hairline and a shadow, and NOT blurred (blur breaks fixed children and is slow on cheap phones)", () => {
    const glass = css.slice(css.indexOf(".tm-glass {"), css.indexOf("}", css.indexOf(".tm-glass {")));
    expect(glass).toContain("rgba(255, 255, 255, 0.97)"); expect(glass).toContain("var(--line)"); expect(glass).toContain("--tm-shadow-float");
    expect(css).not.toMatch(/backdrop-filter/);
  });
  it("the page can never be wider than the phone: html clips sideways too, so the body's own clip applies (a stray wide element used to zoom the whole app out)", () => {
    const html = css.slice(css.indexOf("html {"), css.indexOf("}", css.indexOf("html {")));
    expect(html).toContain("overflow-x: clip");
    expect(css.slice(css.indexOf("body {"), css.indexOf("}", css.indexOf("body {")))).toContain("overflow-x: clip");
  });
  it("taps are immediate and carry no grey flash", () => { expect(css).toContain("-webkit-tap-highlight-color: transparent"); expect(css).toContain("touch-action: manipulation"); });
  it("cards get one soft shadow in a CSS layer, so a component's own shadow still wins", () => { expect(css).toMatch(/@layer components \{[^}]*--tm-shadow-card/); });
  it("everything that moves still stops for people who prefer less motion", () => { expect(css).toContain("@media (prefers-reduced-motion: reduce)"); expect(css).toMatch(/animation-duration: 0\.01ms !important/); });
});

describe("the phone's own bars match the page", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  it("the address bar is the page's warm white on phones, and the installed app's status bar text is dark", () => {
    expect(layout).toContain('media: "(max-width: 767px)", color: "#faf8f3"'); expect(layout).toContain('statusBarStyle: "default"');
  });
  it("the installed app's splash and theme colour are the same warm white as the opening screen; the icon tile stays deep green", () => {
    const pwa = readFileSync("lib/pwa.tsx", "utf8");
    expect(pwa).toContain('PWA_THEME = "#faf8f3"'); expect(pwa).toContain('PWA_BACKGROUND = "#faf8f3"'); expect(pwa).toContain('PWA_TILE = "#0b3d3a"');
  });
});
