import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKDROP_COLORS } from "@/components/shell/MobileBackdrop";

// The mobile theme is a presentation layer: it must stay on phones, and everything on it must be readable. Nothing here renders a
// screen (that needs a real phone), but these checks stop the mistakes that make a dark theme unusable.
const css = readFileSync("app/globals.css", "utf8");
const MARK = "MOBILE THEME";
const start = css.indexOf("@media (max-width: 767px) {", css.indexOf(MARK));
if (start < 0) throw new Error("The mobile theme must be inside a `@media (max-width: 767px) {` block after the MOBILE THEME banner in app/globals.css");
function block(from: number): string {
  let depth = 0;
  for (let i = css.indexOf("{", from); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", from) + 1, i);
  }
  throw new Error("unbalanced CSS");
}
const mobile = block(start);
const desktop = css.slice(0, css.indexOf("/* ══", 0)) + css.slice(start + mobile.length + 40);

// ---- colour maths (WCAG 2.x) ------------------------------------------------------------------------------------------------
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

const vars: Record<string, string> = {};
for (const m of mobile.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
const v = (name: string) => parse(vars[name]);

// What is behind a card: the deep ground, the lightest ridge (hazed), and the two brightest parts of the sky (behind the header only).
const ground = parse(BACKDROP_COLORS.ground);
const ridgeHazed = over([...parse(BACKDROP_COLORS.farRidge).slice(0, 3), 0.6] as RGBA, ground);
const brightest: RGBA[] = [parse("#ffe9b0"), parse(BACKDROP_COLORS.horizon)];
const glass = v("--tm-glass");
const cards = [ground, ridgeHazed, ...brightest].map((b) => over(glass, b)); // a glass card over each of them
const tinted = (tint: string) => cards.map((c) => over(v(tint), c));

describe("the mobile theme stays on phones", () => {
  it("lives entirely inside one max-width: 767px media query", () => {
    expect(start).toBeGreaterThan(0);
    expect(css.match(/@media \(max-width: 767px\)/g)).toHaveLength(2); // the theme, plus the small map-controls rule; both phone-only
  });
  it("leaves the light theme exactly as it was (desktop tokens and colour scheme unchanged)", () => {
    expect(desktop).toContain("--sky: #eaf4f1;"); expect(desktop).toContain("--ink: #1c2430;"); expect(desktop).toContain("--line: #d8e3e0;");
    expect(desktop).toContain("--pine: #0b3d3a;"); expect(desktop).toContain("--background: #eaf4f1;"); expect(desktop).toContain("color-scheme: light;");
  });
  it("none of the mobile rules leak outside the media query", () => {
    for (const marker of [".tm-glass", "--tm-glass", "tm-cream", "color-scheme: dark", ".text-pine", ".bg-pine", "::placeholder"]) expect(desktop).not.toContain(marker);
  });
  it("uses no blur on ordinary cards (blur breaks position:fixed children and is slow on low-end phones), only on the opt-in .tm-glass", () => {
    const cardRules = mobile.slice(mobile.indexOf(':is([class~="bg-white"]'), mobile.indexOf(".tm-glass {"));
    expect(cardRules).not.toContain("backdrop-filter");
    expect(mobile).toContain("prefers-reduced-transparency"); // and glass becomes solid for people who ask for that
  });
  it("keeps title text DARK on the bright marigold buttons (cream there would be unreadable), and cream everywhere else", () => {
    expect(mobile).toContain(".text-pine { color: var(--tm-cream); }");
    const exception = mobile.slice(mobile.indexOf(".text-pine:where("));
    expect(exception.slice(0, exception.indexOf("}"))).toMatch(/bg-marigold[\s\S]*bg-marigold-light[\s\S]*#f0b254[\s\S]*#d9942d[\s\S]*color: #0b3d3a/);
    expect(mobile.indexOf(".text-pine:where(")).toBeGreaterThan(mobile.indexOf(".text-pine { color")); // later, so it wins (equal specificity)
  });
  it("keeps white overlays on dark bars as highlights: only real surfaces become glass", () => {
    const surfaces = /:is\(([^)]*)\)\s*\{\s*background-color: var\(--tm-glass\)/.exec(mobile)?.[1] ?? "";
    for (const ok of ["bg-white\"", "bg-white/95", "bg-white/70", "bg-white/50"]) expect(surfaces).toContain(ok);
    for (const keep of ["bg-white/5\"", "bg-white/10", "bg-white/15", "bg-white/20", "bg-white/25"]) expect(surfaces).not.toContain(keep);
  });
  it("makes the phone's native controls dark too (date and time pickers, selects)", () => expect(mobile).toContain("color-scheme: dark"));
});

describe("every text colour is readable on every surface it can sit on (WCAG AA, 4.5:1)", () => {
  const textColors: Record<string, string> = { "text-pine (cream)": "--tm-cream", "text-ink / foreground": "--ink", "text-ink-muted": "--ink-muted", "text-ink-soft": "--ink-soft" };
  for (const [label, token] of Object.entries(textColors)) {
    it(`${label} on a glass card, over the darkest and the brightest backdrop`, () => { for (const c of cards) expect(contrast(v(token), c)).toBeGreaterThanOrEqual(4.5); });
    it(`${label} straight on the backdrop (page titles), over the ground and the lightest ridge`, () => { for (const b of [ground, ridgeHazed]) expect(contrast(v(token), b)).toBeGreaterThanOrEqual(4.5); });
  }
  it("muted text also reads on every tinted surface (tags, chips, notes)", () => {
    for (const tint of ["--sky", "--teal-light", "--marigold-light", "--clay-light"]) for (const s of tinted(tint)) expect(contrast(v("--ink-muted"), s)).toBeGreaterThanOrEqual(4.5);
  });
  it("teal-ink on its teal tint, clay-ink on its clay tint, and both on plain glass", () => {
    for (const s of [...tinted("--teal-light"), ...cards]) expect(contrast(v("--teal-ink"), s)).toBeGreaterThanOrEqual(4.5);
    for (const s of [...tinted("--clay-light"), ...cards]) expect(contrast(v("--clay-ink"), s)).toBeGreaterThanOrEqual(4.5);
  });
  it("the re-mapped hard-coded colours read on their own tinted surfaces", () => {
    const amber = tinted("--marigold-light"); for (const s of amber) expect(contrast(parse("#ffd9a0"), s)).toBeGreaterThanOrEqual(4.5);       // was #7a4a00 on pale amber
    const clay = cards.map((c) => over(parse("rgba(224,110,70,0.22)"), c)); for (const s of clay) expect(contrast(parse("#ffc4ac"), s)).toBeGreaterThanOrEqual(4.5);
    const blue = cards.map((c) => over(parse("rgba(120,170,210,0.17)"), c)); for (const s of blue) expect(contrast(parse("#cfe4f2"), s)).toBeGreaterThanOrEqual(4.5);
    const route = cards.map((c) => over(parse("rgba(26,115,232,0.26)"), c)); for (const s of route) expect(contrast(v("--tm-cream"), s)).toBeGreaterThanOrEqual(4.5); // the selected route
    for (const s of cards) { expect(contrast(parse("#8ab4f8"), s)).toBeGreaterThanOrEqual(4.5); expect(contrast(parse("#5fd8bd"), s)).toBeGreaterThanOrEqual(4.5); }
  });
  it("white on the deep-green buttons and chips, on the teal avatar, and dark green on the marigold buttons", () => {
    expect(contrast(parse("#ffffff"), parse("#0f5a50"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parse("#ffffff"), parse("#1c7c6d"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parse("#0b3d3a"), parse("#e8a33d"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parse("#0b3d3a"), parse("#f0b254"))).toBeGreaterThanOrEqual(4.5);
  });
  it("the header: white on the sky behind it, and the tagline at 75% white, where they sit", () => {
    expect(contrast(parse("#ffffff"), parse("#8a5a38"))).toBeGreaterThanOrEqual(4.5);
    const skyAtTagline = parse("#394a3a"); // the sky stops (#173f3b → #8a5a38) around y=75
    expect(contrast(over([255, 255, 255, 0.75], skyAtTagline), skyAtTagline)).toBeGreaterThanOrEqual(4.5);
  });
  it("the glass is dark enough that the brightest sky behind a card can never wash it out", () => {
    for (const c of cards) expect(lum(c)).toBeLessThan(0.1);
  });
});

describe("no hard-coded light colour slips through without a phone override", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) files(p, out); else if (/\.tsx$/.test(n)) out.push(p); }
    return out;
  }
  const source = [...files("components"), ...files("app")].map((p) => readFileSync(p, "utf8")).join("\n");
  const found = (kind: string) => [...new Set([...source.matchAll(new RegExp(`${kind}-\\[(#[0-9a-fA-F]{6})\\]`, "g"))].map((m) => m[1]))];
  const hexLum = (h: string) => lum(parse(h));
  // Reviewed on purpose: exceptions that are readable as they are. (Empty: the red flag icon WAS on this list and the contrast check below
  // showed it was only 1.9:1 on dark glass, so it now has a lighter replacement like every other colour.)
  const REVIEWED = new Set<string>();

  it("every light hard-coded BACKGROUND has a dark-theme replacement", () => {
    const missing = found("bg").filter((h) => hexLum(h) > 0.55 && !mobile.includes(`bg-[${h}]`));
    expect(missing).toEqual([]);
  });
  it("every dark hard-coded TEXT colour has a light replacement (unless reviewed)", () => {
    const missing = found("text").filter((h) => hexLum(h) < 0.3 && !REVIEWED.has(h) && !mobile.includes(`text-[${h}]`));
    expect(missing).toEqual([]);
  });
  it("every pale hard-coded BORDER has a replacement", () => {
    const missing = found("border").filter((h) => hexLum(h) > 0.4 && !mobile.includes(`border-[${h}]`));
    expect(missing).toEqual([]);
  });
  it("the red flag icon's replacement is readable on glass (AA), where the original red is not", () => {
    expect(mobile).toContain('[class*="text-[#d93025]"] { color: #ff8a80; }');
    for (const c of cards) expect(contrast(parse("#ff8a80"), c)).toBeGreaterThanOrEqual(4.5);
    for (const c of cards) expect(contrast(parse("#d93025"), c)).toBeLessThan(4.5); // the original red does not reach AA, so the override is needed
  });
});
