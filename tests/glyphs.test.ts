import { describe, expect, it } from "vitest";
import { GLYPHS, KIND_GLYPH, CATEGORY_GLYPH, REPORT_TAG_GLYPH, TONES } from "@/lib/glyphs";
import { POI_KINDS } from "@/lib/poi/types";
import { NEARBY_KIND_IDS } from "@/lib/nearby";
import { CATEGORIES } from "@/lib/categories";
import { REPORT_TAGS } from "@/lib/reports";

// Every kind of place the app can show must have a real vector icon (never a blank or an emoji).
describe("icons", () => {
  it("covers every road place kind", () => {
    for (const k of POI_KINDS) expect(GLYPHS[KIND_GLYPH[k]?.glyph], `kind ${k}`).toBeTruthy();
  });
  it("covers every nearby search kind", () => {
    for (const k of NEARBY_KIND_IDS) expect(GLYPHS[KIND_GLYPH[k]?.glyph], `nearby ${k}`).toBeTruthy();
  });
  it("covers every trip place category", () => {
    for (const c of Object.keys(CATEGORIES)) expect(GLYPHS[CATEGORY_GLYPH[c]?.glyph], `category ${c}`).toBeTruthy();
  });
  it("covers every community update tag", () => {
    for (const t of Object.keys(REPORT_TAGS)) expect(GLYPHS[REPORT_TAG_GLYPH[t]], `tag ${t}`).toBeTruthy();
  });
  it("every icon has drawable shapes and every tone is defined", () => {
    for (const [name, node] of Object.entries(GLYPHS)) expect(node.length, name).toBeGreaterThan(0);
    for (const e of [...Object.values(KIND_GLYPH), ...Object.values(CATEGORY_GLYPH)]) expect(TONES[e.tone]).toBeTruthy();
  });
});
