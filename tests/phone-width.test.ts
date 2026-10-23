// Fails if a screen becomes wider than a phone. On 22 Oct 2026 the trip Weather page (and the Plan page once a stop's weather was opened)
// was wider than the screen, so phones showed it zoomed out: screen-reader labels (position: absolute) inside the sideways-scrolling
// "next 12 hours" row escaped the row, because the row was not a positioned box. The real screens are rendered with the app's built CSS
// and measured in headless Chrome at 360, 390 and 412 px (scripts/phone-width.tsx). Skipped when Chrome or a build is missing.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHROME, cssDir, measurePages, pages } from "../scripts/phone-width";

const ready = !!CHROME && existsSync(cssDir);

describe.skipIf(!ready)("no screen is wider than the phone (360, 390, 412 px)", () => {
  const results = ready ? measurePages(pages, mkdtempSync(path.join(tmpdir(), "phone-width-"))) : [];
  it("the check really catches the old bug (control: a scroll row that lets its hidden labels escape)", () => {
    const control = results.filter((x) => x.page === "control");
    expect(control).toHaveLength(3);
    for (const r of control) expect(r.bad.length, `control at ${r.width}`).toBeGreaterThan(0);
  });
  for (const page of Object.keys(pages).filter((p) => p !== "control")) {
    it(`${page}: as wide as the screen at every width, nothing sticking out`, () => {
      const rs = results.filter((x) => x.page === page);
      expect(rs).toHaveLength(3);
      for (const r of rs) {
        expect(r.W, `${page} at ${r.width}`).toBe(r.width);
        expect(r.scroll, `${page} at ${r.width}: ${r.bad.join(" | ")}`).toBeLessThanOrEqual(r.width);
        expect(r.bad, `${page} at ${r.width}`).toEqual([]);
      }
    });
  }
}, 120_000);
