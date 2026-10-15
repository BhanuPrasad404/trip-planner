import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefFitCard } from "@/components/BriefFitCard";
import { initialSelection } from "@/components/ImportPanel";
import { evaluateBrief, type BriefCandidate } from "@/lib/trip-builder/brief";
import type { ImportCandidate } from "@/lib/import/pipeline";
import { roadMatrix } from "./builder-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const HYD = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
const c = (id: string, name: string, lat: number, lng: number, extra: Partial<BriefCandidate> = {}): BriefCandidate => ({ id, name, lat, lng, category: "temple", confidence: 0.9, ...extra });
const fit = (cands: BriefCandidate[], constraints = {}, numDays = 2) => evaluateBrief({ candidates: cands, start: HYD, numDays, startDateISO: "2026-10-23", utcOffsetMin: 330, constraints, matrix: roadMatrix([HYD, ...cands]) });
const html = (f: ReturnType<typeof fit>) => renderToStaticMarkup(<BriefFitCard fit={f} />);

describe("BriefFitCard", () => {
  it("a plan that fits: says so in words, shows days with 12-hour times, and what was checked against", () => {
    const h = html(fit([c("a", "Srisailam", 16.0744, 78.8683), c("b", "Nagarjuna Sagar", 16.5757, 79.3115)], { maxDriveHours: 5, direction: "S" }));
    expect(h).toContain("Fits"); expect(h).toContain("fit in 2 days"); expect(h).toContain("Day 1"); expect(h).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    expect(h).toContain("Checked against:"); expect(h).toContain("up to 5 h driving a day"); expect(h).toContain("heading S");
    expect(h).not.toMatch(/\b\d{2}:\d{2}\b(?! (AM|PM))/); // never a 24-hour clock on screen
  });
  it("a plan that doesn't fit: lists what was left out and why, and what could be changed", () => {
    const h = html(fit([c("a", "Warangal", 17.9689, 79.5941), c("b", "Ramappa", 18.2594, 79.9433), c("v", "Vizag", 17.6868, 83.2185)], {}, 1));
    expect(h).toMatch(/Left out \(\d+\)/); expect(h).toContain("Vizag"); expect(h).toMatch(/of driving from Hyderabad/);
  });
  it("must-do problems are shown as plain sentences, not codes", () => {
    const h = html(fit([c("a", "Warangal", 17.9689, 79.5941, { must: true }), c("b", "Ramappa", 18.2594, 79.9433, { must: true }), c("n", "Nagarjuna Sagar", 16.5757, 79.3115, { must: true }), c("x", "Bhadrachalam", 17.668, 80.893, { must: true })], {}, 1));
    expect(h).toContain("Things to know"); expect(h).not.toMatch(/must_exceeds_days|must_unreachable/);
  });
  it("says it could not check, rather than looking vetted, when there is no start point", () => {
    const h = html(evaluateBrief({ candidates: [c("a", "X", 17, 78)], start: { lat: NaN, lng: NaN, label: "?" }, numDays: 2, startDateISO: null, utcOffsetMin: 330, constraints: {}, matrix: roadMatrix([HYD, c("a", "X", 17, 78)]) }));
    expect(h).toContain("Not checked"); expect(h).toContain("Set a starting point"); expect(h).not.toContain("Day 1");
  });
  it("the assumptions are one tap away and mention no live traffic", () => {
    expect(html(fit([c("a", "Srisailam", 16.0744, 78.8683)]))).toMatch(/What this check assumes[\s\S]*No live traffic/);
  });
  it("uses real tap-friendly summaries and escapes names (no raw HTML from a place name)", () => {
    const h = html(fit([c("a", "<img src=x onerror=alert(1)>", 17.4, 78.5)]));
    expect(h).not.toContain("<img src=x"); expect(h).toContain("&lt;img");
  });
});

describe("initialSelection: what starts ticked in the review list", () => {
  const cand = (key: string, o: Partial<ImportCandidate> = {}): ImportCandidate => ({ key, name: key, area: null, address: null, category: "other", lat: 1, lng: 1, confidence: 1, source: "ai_suggestion", note: null, sourceUrl: null, seasonTagId: null, seasonReason: null, seasonGoodMonths: null, warnings: [], duplicate: false, far: false, ...o });
  it("ticks ordinary places, but not duplicates, far-away matches, unlocated places, or places the feasibility check left out", () => {
    const list = [cand("ok"), cand("dup", { duplicate: true }), cand("far", { far: true }), cand("nowhere", { lat: null, lng: null }), cand("cut", { fit: { state: "dropped", code: "no_time", reason: "x" } }), cand("kept", { fit: { state: "kept", day: 1 } })];
    expect([...initialSelection(list)].sort()).toEqual(["kept", "ok"]);
  });
});
