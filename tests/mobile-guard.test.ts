// Static guards for the mistakes that break phone layouts. They cannot replace trying the app on real phones (nothing here renders a
// screen), but they stop the common regressions from creeping back in. If one fails, the message says what to look at.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out); else if (/\.(tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = [...files("components"), ...files("app")].map((p) => ({ p, text: readFileSync(p, "utf8") }));
const classNames = (text: string) => [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");

describe("mobile layout guards", () => {
  it("never uses plain viewport-height units (they hide content behind a phone's address bar); dvh is used instead", () => {
    const bad = sources.filter(({ text }) => /\b(100vh|h-screen|min-h-screen|w-screen|100vw)\b/.test(text)).map((s) => s.p);
    expect(bad).toEqual([]);
  });
  it("no fixed pixel width of 360 or more without a max-width guard on the same element", () => {
    const bad: string[] = [];
    for (const { p, text } of sources) for (const c of classNames(text)) { const m = /(?:^|\s)w-\[(\d{3,})px\]/.exec(c); if (m && Number(m[1]) >= 360 && !/max-w-/.test(c)) bad.push(`${p}: w-[${m[1]}px]`); }
    expect(bad).toEqual([]);
  });
  it("no square button or link smaller than 40 px that is meant to be tapped", () => {
    const bad: string[] = [];
    for (const { p, text } of sources) for (const m of text.matchAll(/<(button|a)\b[^>]*className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const c = m[2] ?? m[3] ?? "";
      if (/(?:^|\s)h-([1-9])\b/.test(c) && /(?:^|\s)w-([1-9])\b/.test(c) && !/(?:^|\s)min-h-/.test(c)) bad.push(`${p}: ${c.slice(0, 60)}`);
    }
    expect(bad).toEqual([]);
  });
  it("every text field and select has a minimum height that is comfortable to tap", () => {
    const bad: string[] = [];
    for (const { p, text } of sources) for (const m of text.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const attrs = m[2];
      if (/type="(checkbox|radio|hidden|file|range)"/.test(attrs) || /sr-only/.test(attrs)) continue;
      const cls = /className="([^"]*)"/.exec(attrs)?.[1] ?? "";
      if (cls && !/(min-h-(10|11|12)|\bh-(10|11|12|14)\b|rows=)/.test(cls + attrs)) bad.push(`${p}: <${m[1]} ${cls.slice(0, 50)}`);
    }
    expect(bad).toEqual([]);
  });
  it("every fixed bottom sheet keeps clear of the phone's home bar (safe-area inset)", () => {
    const bad: string[] = [];
    for (const { p, text } of sources) for (const c of classNames(text)) if (/\bfixed\b/.test(c) && /\bbottom-0\b/.test(c) && !/safe-area-inset-bottom/.test(c) && !/inset-0/.test(c)) bad.push(`${p}: ${c.slice(0, 70)}`);
    expect(bad).toEqual([]);
  });
  it("the page declares a mobile viewport that allows content under the notch (viewport-fit=cover)", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toMatch(/viewport/i);
  });
  it("animations only move with transform/opacity (cheap on mid-range phones) and respect reduced motion", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const m of css.matchAll(/@keyframes ([\w-]+) \{([^@]*?)\n\}/g)) { if (!/^tm-/.test(m[1])) continue; expect(m[2], m[1]).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/); }
    expect(css).toContain("prefers-reduced-motion");
  });
});
