// Scores only look precise when the data behind them is: the Go score number needs season AND weather data; the plan overview shows
// counts, not an average that hides bad or unknown stops; and the Live page doesn't list the same place twice.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoScoreBadge, goScoreLabel } from "@/components/GoScoreBadge";
import { computeGoScore, type GoScore } from "@/lib/goscore";
import { withoutSuggested } from "@/lib/intel/radar";
import type { RadarItem } from "@/lib/intel/types";
import type { Conditions } from "@/lib/weather";

const pleasant = { tempMaxC: 26, precipMmPerDay: 0.2 } as unknown as Conditions;

describe("Go score shows a number only when season AND weather back it", () => {
  it("season + weather: the 0-100 score with its label", () => {
    const s = computeGoScore({ category: "fort", seasonStatus: "good", conditions: pleasant })!;
    expect(s.basis).toBe("season+weather");
    expect(goScoreLabel(s)).toEqual({ text: `Go score · ${s.label} (${s.score}/100)`, number: s.score });
  });
  it("weather only (no researched season data): words about the weather, no number", () => {
    const s = computeGoScore({ category: "fort", seasonStatus: "unknown", conditions: pleasant })!;
    expect(s.basis).toBe("weather");
    expect(s.score).toBeGreaterThanOrEqual(60); // the formula still produces a confident-looking number…
    const shown = goScoreLabel(s);
    expect(shown.number).toBeNull(); // …which we no longer show
    expect(shown.text).toBe("Weather looks good");
    const html = renderToStaticMarkup(<GoScoreBadge score={s} />);
    expect(html).not.toContain("/100"); expect(html).not.toContain("Go score"); expect(html).toContain("about the weather only");
  });
  it("season only (no weather yet): the season fact, no number", () => {
    const s = computeGoScore({ category: "waterfall", seasonStatus: "wrong_season", conditions: null })!;
    expect(s.basis).toBe("season");
    expect(goScoreLabel(s)).toEqual({ text: "Outside its best season", number: null });
    expect(renderToStaticMarkup(<GoScoreBadge score={s} />)).not.toContain("/100");
  });
  it("always says it is an estimate, not a guarantee", () => {
    const s: GoScore = computeGoScore({ category: "fort", seasonStatus: "good", conditions: pleasant })!;
    expect(renderToStaticMarkup(<GoScoreBadge score={s} />)).toContain("not a guarantee");
  });
});

describe("the Live page lists each place once", () => {
  const item = (key: string): RadarItem => ({ key, kind: "fuel", name: key, lat: 0, lng: 0, etaMin: 10, aheadKm: 5, detourMin: 1, open: { state: "unknown" }, note: null, score: 70 } as RadarItem);
  it("a place already offered as a suggestion is not repeated in the Radar", () => {
    const radar = [item("osm/1"), item("osm/2"), item("osm/3")];
    const advice = [{ action: { type: "poi", key: "osm/2" } }, { action: { type: "replan" } }, {}];
    expect(withoutSuggested(radar, advice).map((r) => r.key)).toEqual(["osm/1", "osm/3"]);
  });
  it("with no suggestions, the Radar is unchanged", () => {
    const radar = [item("osm/1")];
    expect(withoutSuggested(radar, [])).toEqual(radar);
  });
});
