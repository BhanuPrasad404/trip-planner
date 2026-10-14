import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportPanel, summaryOf } from "@/components/ImportPanel";
import { runImport } from "@/lib/import/pipeline";
import type { ImportCandidate } from "@/lib/import/pipeline";
import type { ToolCaller } from "@/lib/ai/anthropic";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cand = (o: Partial<ImportCandidate> = {}): ImportCandidate => ({ key: "k", name: "Bhongir Fort", area: null, address: null, category: "fort", lat: 17.5, lng: 78.9, confidence: 0.9, source: "screenshot", note: null, sourceUrl: null, seasonTagId: null, seasonReason: null, seasonGoodMonths: null, warnings: [], duplicate: false, far: false, ...o });
const props = { tripId: "t1", startDate: "2026-10-14", today: "2026-10-12", onDone: () => undefined, onCancel: () => undefined };

describe("opening the import panel is never silent", () => {
  let r: TestRenderer.ReactTestRenderer;
  afterEach(() => act(() => r?.unmount()));
  it("brings the panel into view and puts the cursor in the text box", async () => {
    const scrollIntoView = vi.fn(), focus = vi.fn();
    await act(async () => { r = TestRenderer.create(createElement(ImportPanel, props), { createNodeMock: () => ({ scrollIntoView, focus }) }); });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
});

describe("what the traveller is told about screenshots", () => {
  const h = renderToStaticMarkup(createElement(ImportPanel, props));
  it("explains in steps what happens to a screenshot, and that nothing is added until they confirm", () => {
    expect(h).toContain("What happens to a screenshot?");
    expect(h).toContain("We read the words in the picture");
    expect(h).toContain("Nothing is added until you press Add.");
  });
  it("is honest about what it cannot do: a photo with no words", () => {
    expect(h).toContain("A photo with no words");
    expect(h).toContain("usually can&#x27;t be identified");
  });
  it("tells them the limit of three screenshots up front", () => { expect(h).toContain("Add screenshots (0/3)"); });
});

describe("a result is always summarised in one plain sentence", () => {
  it("nothing found", () => { expect(summaryOf([])).toBe("We didn't find any places."); });
  it("counts, unlocated and already-on-the-trip places", () => {
    const s = summaryOf([cand(), cand({ key: "b", lat: null, lng: null }), cand({ key: "c", duplicate: true })]);
    expect(s).toContain("We found 3 places."); expect(s).toContain("1 couldn't be found on the map"); expect(s).toContain("1 is already on this trip"); expect(s).toContain("Tick the ones you want.");
  });
  it("singular wording", () => { expect(summaryOf([cand()])).toBe("We found 1 place. Tick the ones you want."); });
});

describe("a screenshot with no readable places explains why, instead of 'try a screenshot'", () => {
  const llm: ToolCaller = vi.fn(async () => ({ places: [] }));
  const geocode = vi.fn(async () => null);
  it("image-only input that yields nothing", async () => {
    const r = await runImport({ mode: "extract", text: "", images: [{ media_type: "image/jpeg", data: "AAAA" }], bias: null, seasonTags: [], existing: [] }, { llm, geocode, resolveUrl: async () => null });
    expect(r.candidates).toHaveLength(0);
    expect(r.notes.join(" ")).toContain("couldn't find any place names in your screenshot");
    expect(r.notes.join(" ")).not.toContain("or try a screenshot");
  });
  it("text-only input still suggests adding a screenshot", async () => {
    const r = await runImport({ mode: "extract", text: "some long text without any places in it at all", images: [], bias: null, seasonTags: [], existing: [] }, { llm, geocode, resolveUrl: async () => null });
    expect(r.notes.join(" ")).toContain("add a screenshot that shows the place names");
  });
});
