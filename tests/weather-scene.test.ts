// The picture, colours and motion of each kind of weather. What this pins down:
//   • which scene a bit of weather gets, and that the most serious thing wins;
//   • every scene's text meets WCAG AA contrast on EVERY part of its gradient, and on its small see-through chips (a pretty sky must never
//     make the numbers hard to read);
//   • the animation CSS stops for people who ask for less motion, for every animated class;
//   • particles are the same on the server and the phone (no randomness at render), and a "lite" scene uses fewer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DayPart } from "@/lib/forecast/day-parts";
import type { Moment } from "@/lib/forecast/moment";
import { ALERT_PALETTE, CLOUDS, COLD_FEELS_C, HOUR_PILL, PALETTE, SCENE_RANK, SCENE_WORD, gradientOf, sceneForMoment, sceneForPart, type SceneKind } from "@/lib/forecast/scene";
import { COUNTS, countFor, unit } from "@/components/weather/WeatherScene";

const moment = (o: Partial<Moment> = {}): Moment => ({ status: "ok", at: 0, shownAt: 0, rainFrom: null, rainTo: null, tempC: 28, feelsC: 29, code: 0, visibilityM: 10000, precipMm: 0, precipProb: 5, gustKmh: 10, isDay: true, condition: null, hazards: [], level: null, fetchedAt: 0, ...o });
const hazard = (kind: "rain" | "storm" | "visibility" | "heat", level: "watch" | "warning" | "severe") => ({ kind, level, label: `${kind} ${level}`, detail: "" });
const part = (o: Partial<DayPart> = {}): DayPart => ({ id: "afternoon", label: "Afternoon", from: 0, to: 1, coverage: "ok", hoursForecast: 5, hoursInPart: 5, past: false, tempMinC: 26, tempMaxC: 31, feelsMaxC: 33, rainChanceMax: 10, rainMmMax: 0, worst: null, mostlyDay: true, ...o });

describe("which scene a moment gets", () => {
  it("clear skies are sunny by day and a clear night by night", () => {
    expect(sceneForMoment(moment()).kind).toBe("sun");
    expect(sceneForMoment(moment({ isDay: false })).kind).toBe("clear_night");
  });
  it("cloud cover shows clouds, day or night; overcast is heavier than partly cloudy", () => {
    expect(sceneForMoment(moment({ code: 2 }))).toEqual({ kind: "cloud", intensity: 1 });
    expect(sceneForMoment(moment({ code: 3 }))).toEqual({ kind: "cloud", intensity: 2 });
    expect(sceneForMoment(moment({ code: 3, isDay: false })).kind).toBe("cloud_night");
  });
  it("rain: likely rain is rain, a heavy-rain warning is heavy rain, drizzle is light", () => {
    expect(sceneForMoment(moment({ precipProb: 80, precipMm: 1 })).kind).toBe("rain");
    expect(sceneForMoment(moment({ code: 53, precipProb: 80, precipMm: 0.5 }))).toMatchObject({ kind: "rain", intensity: 1 });
    expect(sceneForMoment(moment({ hazards: [hazard("rain", "warning")] }))).toMatchObject({ kind: "heavy_rain", intensity: 2 });
    expect(sceneForMoment(moment({ hazards: [hazard("rain", "severe")] }))).toMatchObject({ kind: "heavy_rain", intensity: 3 });
  });
  it("a thunderstorm beats everything, including heavy rain", () => {
    expect(sceneForMoment(moment({ hazards: [hazard("rain", "severe"), hazard("storm", "warning")] })).kind).toBe("storm");
  });
  it("fog and low visibility show fog, with more mist when it is worse", () => {
    expect(sceneForMoment(moment({ hazards: [hazard("visibility", "warning")] }))).toMatchObject({ kind: "fog", intensity: 2 });
    expect(sceneForMoment(moment({ hazards: [hazard("visibility", "severe")] })).intensity).toBe(3);
  });
  it("heat shows heat, and snow codes show snow", () => {
    expect(sceneForMoment(moment({ hazards: [hazard("heat", "warning")] })).kind).toBe("heat");
    expect(sceneForMoment(moment({ code: 73, tempC: 1, feelsC: -2 })).kind).toBe("snow");
    expect(sceneForMoment(moment({ code: 86 })).kind).toBe("snow");
  });
  it("cold shows cold at or below the cold line, harder the colder it is, but only when nothing worse is happening", () => {
    expect(COLD_FEELS_C).toBe(14);
    expect(sceneForMoment(moment({ tempC: 14, feelsC: 14 }))).toMatchObject({ kind: "cold", intensity: 1 });
    expect(sceneForMoment(moment({ tempC: 9, feelsC: 9 })).intensity).toBe(2);
    expect(sceneForMoment(moment({ tempC: 5, feelsC: 5 })).intensity).toBe(3);
    expect(sceneForMoment(moment({ tempC: 15, feelsC: 15 })).kind).toBe("sun");
    expect(sceneForMoment(moment({ tempC: 6, feelsC: 6, hazards: [hazard("rain", "warning")] })).kind).toBe("heavy_rain");
  });
  it("with no temperature numbers at all it still gives a scene (it never throws)", () => {
    expect(sceneForMoment(moment({ tempC: null, feelsC: null })).kind).toBe("sun");
  });
});

describe("which scene a part of a day gets (parts carry no cloud cover, so cloud is never claimed)", () => {
  it("a part with no forecast has no scene", () => expect(sceneForPart(part({ coverage: "none" }))).toBeNull());
  it("storm, fog, rain warnings and likely rain show their weather", () => {
    expect(sceneForPart(part({ worst: hazard("storm", "warning") }))?.kind).toBe("storm");
    expect(sceneForPart(part({ worst: hazard("visibility", "warning") }))?.kind).toBe("fog");
    expect(sceneForPart(part({ worst: hazard("rain", "warning") }))?.kind).toBe("heavy_rain");
    expect(sceneForPart(part({ worst: hazard("rain", "watch") }))?.kind).toBe("rain");
    expect(sceneForPart(part({ rainChanceMax: 70 }))?.kind).toBe("rain");
  });
  it("an evening is sun, a night is a clear night, heat is heat, a cold morning is cold", () => {
    expect(sceneForPart(part())?.kind).toBe("sun");
    expect(sceneForPart(part({ id: "night", mostlyDay: false }))?.kind).toBe("clear_night");
    expect(sceneForPart(part({ worst: hazard("heat", "warning") }))?.kind).toBe("heat");
    expect(sceneForPart(part({ feelsMaxC: 10, tempMaxC: 12 }))?.kind).toBe("cold");
  });
  it("a missing field never breaks it (a part from an older answer)", () => {
    expect(sceneForPart({ id: "morning", label: "Morning", past: false, coverage: "ok" } as never)?.kind).toBe("sun");
  });
});

describe("the scenes are ordered by how much they matter", () => {
  it("a storm outranks heavy rain, which outranks fog, rain, heat, cold, cloud, sun", () => {
    const order: SceneKind[] = ["storm", "heavy_rain", "snow", "fog", "rain", "heat", "cold", "cloud", "sun"];
    for (let i = 1; i < order.length; i++) expect(SCENE_RANK[order[i - 1]], `${order[i - 1]} > ${order[i]}`).toBeGreaterThan(SCENE_RANK[order[i]]);
  });
  it("every scene has a word for screen readers, and none of them says 'Hot' (a day never says it)", () => {
    for (const k of Object.keys(PALETTE) as SceneKind[]) { expect(SCENE_WORD[k].length, k).toBeGreaterThan(2); expect(SCENE_WORD[k]).not.toMatch(/\bhot\b/i); }
  });
});

// ── contrast: WCAG 2.x ──
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (over: string, base: [number, number, number]): [number, number, number] => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(over)!; const a = Number(m[4]);
  return [0, 1, 2].map((i) => Math.round(Number(m[i + 1]) * a + base[i] * (1 - a))) as [number, number, number];
};
describe("every scene is readable (WCAG AA, 4.5 to 1)", () => {
  for (const k of Object.keys(PALETTE) as SceneKind[]) {
    const p = PALETTE[k];
    it(`${k}: text and secondary text on all three parts of the gradient, and on the chips`, () => {
      for (const stop of [p.from, p.via, p.to]) {
        expect(ratio(rgb(p.text), rgb(stop)), `${k} text on ${stop}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(rgb(p.muted), rgb(stop)), `${k} muted on ${stop}`).toBeGreaterThanOrEqual(4.5);
        const onChip = blend(p.chip, rgb(stop));
        expect(ratio(rgb(p.text), onChip), `${k} text on a chip over ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("the gradient is built from the palette, in order", () => expect(gradientOf("rain")).toBe("linear-gradient(155deg, #22589A 0%, #1B4478 55%, #112C50 100%)"));
});

describe("alert banners and hour pills are readable too", () => {
  it("every alert level: its text on its own solid background, and its border visible against the background (3 to 1)", () => {
    for (const l of ["watch", "warning", "severe"] as const) {
      const a = ALERT_PALETTE[l];
      expect(ratio(rgb(a.text), rgb(a.bg)), `${l} text`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(rgb(a.border), rgb(a.bg)), `${l} border`).toBeGreaterThanOrEqual(3);
    }
  });
  it("the three levels look different from each other (never colour alone, but never the same colour either)", () => {
    expect(new Set(Object.values(ALERT_PALETTE).map((a) => a.bg)).size).toBe(3);
  });
  it("hour pills: dark text on the day pill at both ends, white on the night pill at both ends", () => {
    for (const stop of ["#fff3c4", "#ffe0a3"]) expect(ratio(rgb(HOUR_PILL.day.text), rgb(stop))).toBeGreaterThanOrEqual(4.5);
    for (const stop of ["#26325a", "#151c38"]) expect(ratio(rgb(HOUR_PILL.night.text), rgb(stop))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("clouds never make the numbers harder to read", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const cloudRgb = (re: RegExp) => { const m = re.exec(css)!; return [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]; };
  const light = cloudRgb(/\.wx-cloud \{[^}]*background: rgba\((\d+),(\d+),(\d+),var\(--o\)\)/), dark = cloudRgb(/\.wx-cloud-dark \{ background: rgba\((\d+),(\d+),(\d+),var\(--o\)\)/);
  const over = (c: [number, number, number], a: number, base: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => Math.round(c[i] * a + base[i] * (1 - a))) as [number, number, number];
  it("every scene with clouds is listed, and a dark sky (white text) only ever gets DARK clouds; the sunny sky (dark text) gets light ones", () => {
    for (const [kind, c] of Object.entries(CLOUDS) as [SceneKind, NonNullable<(typeof CLOUDS)[SceneKind]>][]) {
      const textLum = lum(rgb(PALETTE[kind].text));
      expect(c.tone, kind).toBe(textLum > 0.5 ? "dark" : "light");
    }
  });
  it("even two of the strongest clouds stacked on the lightest part of the sky leave the text AA readable", () => {
    for (const [kind, c] of Object.entries(CLOUDS) as [SceneKind, NonNullable<(typeof CLOUDS)[SceneKind]>][]) {
      const colour = c.tone === "dark" ? dark : light;
      const stacked = 1 - (1 - c.o) ** 2;
      for (const stop of [PALETTE[kind].from, PALETTE[kind].via, PALETTE[kind].to]) {
        expect(ratio(rgb(PALETTE[kind].text), over(colour, stacked, rgb(stop))), `${kind} on ${stop}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(rgb(PALETTE[kind].muted), over(colour, stacked, rgb(stop))), `${kind} muted on ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("the scenes with no clouds are not in the list (so none can be added without being checked)", () => {
    expect(Object.keys(CLOUDS).sort()).toEqual(["cloud", "cloud_night", "heavy_rain", "rain", "storm", "sun"]);
  });
});

describe("the animation CSS (app/globals.css)", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const section = css.slice(css.indexOf("WEATHER SCENES"));
  const reduced = section.slice(section.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  const animated = [...section.matchAll(/\.(wx-[a-z-]+)[^{]*\{[^}]*animation:/g)].map((m) => m[1]);
  it("has an animation for every kind of weather", () => {
    for (const c of ["wx-drop", "wx-flake", "wx-sun", "wx-rays", "wx-moon", "wx-star", "wx-cloud", "wx-flash", "wx-bolt", "wx-mist", "wx-heat-glow", "wx-shimmer", "wx-frost"]) expect(animated, c).toContain(c);
  });
  it("switches EVERY animated class off for people who ask for less motion", () => {
    expect(animated.length).toBeGreaterThan(12);
    for (const c of new Set(animated)) expect(reduced, `${c} must be stopped in the reduced-motion block`).toContain(`.${c}`);
    expect(reduced).toContain("animation: none !important");
  });
  it("never takes a tap and never changes the card's size", () => {
    expect(section).toMatch(/\.wx-scene \{[^}]*position: absolute; inset: 0;[^}]*pointer-events: none/);
  });
  it("pauses off-screen scenes", () => expect(section).toContain('.wx-scene[data-paused="true"] * { animation-play-state: paused !important; }'));
});

describe("particles", () => {
  it("are the same every time for the same number (so the server and the phone draw the same thing)", () => {
    for (let i = 0; i < 50; i++) { expect(unit(i, 3)).toBe(unit(i, 3)); expect(unit(i, 3)).toBeGreaterThanOrEqual(0); expect(unit(i, 3)).toBeLessThan(1); }
    expect(unit(0, 1)).not.toBe(unit(1, 1));
  });
  it("are spread out, not bunched", () => {
    const xs = Array.from({ length: 200 }, (_, i) => unit(i, 1));
    const buckets = new Array(10).fill(0);
    for (const x of xs) buckets[Math.floor(x * 10)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(8);
  });
  it("heavier weather has more, a lite scene has fewer", () => {
    for (const what of ["rain", "snow", "stars"] as const) {
      expect(countFor(what, 1)).toBeLessThan(countFor(what, 3));
      expect(countFor(`${what}Lite` as keyof typeof COUNTS, 3)).toBeLessThan(countFor(what, 1));
    }
  });
});
