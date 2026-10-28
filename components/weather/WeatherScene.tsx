"use client";

// The moving picture behind a weather card: sun, moon and stars, clouds, rain, a storm, fog, heat shimmer, cold and snow. Decoration only:
// hidden from screen readers (the words next to it say the same thing), never takes a tap, never changes the card's size.
// Particle positions come from an integer hash of their number, NOT Math.random: the server and the phone draw exactly the same thing, so
// nothing jumps when the page loads. A "lite" scene (every card but the first) uses a third of the particles, so a long list stays smooth;
// a scene that is off screen is paused. The CSS is in app/globals.css ("WEATHER SCENES") and stops for people who ask for less motion.
import { useEffect, useRef, type CSSProperties } from "react";
import { CLOUDS, type Intensity, type SceneKind } from "@/lib/forecast/scene";

/** 0..1, always the same for the same (i, salt). Integer maths only. */
export function unit(i: number, salt: number): number {
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const sec = (v: number) => `${Math.round(v * 100) / 100}s`;
const style = (o: Record<string, string | number>) => o as CSSProperties;

/** How many of each particle: [light, normal, heavy]. */
export const COUNTS = {
  rain: [22, 34, 48], rainLite: [8, 12, 16],
  snow: [16, 28, 40], snowLite: [7, 10, 14],
  stars: [14, 18, 22], starsLite: [6, 8, 10],
} as const;
export const countFor = (what: keyof typeof COUNTS, intensity: Intensity) => COUNTS[what][intensity - 1];

const Drops = ({ n, speed, long }: { n: number; speed: number; long: number }) => (
  <>{Array.from({ length: n }, (_, i) => <i key={i} className="wx-drop" style={style({ "--x": pct(unit(i, 1)), "--len": `${Math.round(long * (0.6 + unit(i, 2) * 0.8))}px`, "--dur": sec((0.55 + unit(i, 3) * 0.5) / speed), "--delay": sec(-unit(i, 4) * 1.6), "--o": Math.round((0.35 + unit(i, 5) * 0.5) * 100) / 100, "--y": Math.round(unit(i, 6) * 80) })} />)}</>
);
const Flakes = ({ n, big }: { n: number; big: boolean }) => (
  <>{Array.from({ length: n }, (_, i) => <i key={i} className="wx-flake" style={style({ "--x": pct(unit(i, 11)), "--size": `${Math.round((big ? 4 : 3) + unit(i, 12) * (big ? 5 : 3))}px`, "--dur": sec(5 + unit(i, 13) * 5), "--delay": sec(-unit(i, 14) * 9), "--sway": `${Math.round((unit(i, 15) - 0.5) * 36)}px`, "--o": Math.round((0.55 + unit(i, 16) * 0.45) * 100) / 100, "--y": Math.round(unit(i, 17) * 80) })} />)}</>
);
const Stars = ({ n }: { n: number }) => (
  <>{Array.from({ length: n }, (_, i) => <i key={i} className="wx-star" style={style({ "--x": pct(unit(i, 21) * 0.92), "--y": pct(unit(i, 22) * 0.85), "--size": `${Math.round(2 + unit(i, 23) * 2.4)}px`, "--dur": sec(1.8 + unit(i, 24) * 2.8), "--delay": sec(-unit(i, 25) * 4) })} />)}</>
);
const Clouds = ({ n, kind }: { n: number; kind: keyof typeof CLOUDS }) => {
  const c = CLOUDS[kind]!;
  return (
    <>{Array.from({ length: n }, (_, i) => <i key={i} className={`wx-cloud${c.tone === "dark" ? " wx-cloud-dark" : ""}`} style={style({ "--y": `${Math.round(c.top + unit(i, 31) * 34)}%`, "--w": `${Math.round(86 + unit(i, 32) * 70)}px`, "--dur": sec(34 + unit(i, 33) * 30), "--delay": sec(-unit(i, 34) * 50), "--o": Math.round((c.o - unit(i, 35) * 0.12) * 100) / 100 })} />)}</>
  );
};
const Mist = ({ n }: { n: number }) => (
  <>{Array.from({ length: n }, (_, i) => <i key={i} className="wx-mist" style={style({ "--y": `${Math.round(8 + (i / Math.max(1, n - 1)) * 58)}%`, "--o": Math.round((0.5 + unit(i, 41) * 0.3) * 100) / 100, "--dur": sec(9 + unit(i, 42) * 8), "--delay": sec(-unit(i, 43) * 9) })} />)}</>
);

export function WeatherScene({ kind, intensity = 2, lite = false }: { kind: SceneKind; intensity?: Intensity; lite?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Off screen = paused: a list of many cards stays cheap.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => { if (e) el.dataset.paused = e.isIntersecting ? "false" : "true"; });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const rainN = countFor(lite ? "rainLite" : "rain", intensity), snowN = countFor(lite ? "snowLite" : "snow", intensity), starN = countFor(lite ? "starsLite" : "stars", intensity);
  return (
    <div ref={ref} aria-hidden="true" className="wx-scene" data-scene={kind} data-lite={lite ? "true" : undefined}>
      {kind === "sun" && <><i className="wx-rays" /><i className="wx-sun" />{!lite && <Clouds n={2} kind="sun" />}</>}
      {kind === "clear_night" && <><i className="wx-moon" /><Stars n={starN} /></>}
      {kind === "cloud" && <Clouds n={lite ? 2 : 4} kind="cloud" />}
      {kind === "cloud_night" && <><i className="wx-moon" style={{ opacity: 0.55 }} /><Stars n={Math.round(starN / 2)} /><Clouds n={lite ? 2 : 3} kind="cloud_night" /></>}
      {kind === "rain" && <><Clouds n={lite ? 2 : 3} kind="rain" /><Drops n={rainN} speed={1} long={22} /></>}
      {kind === "heavy_rain" && <><Clouds n={lite ? 2 : 4} kind="heavy_rain" /><Drops n={Math.round(rainN * 1.3)} speed={1.7} long={30} /></>}
      {kind === "storm" && <><Clouds n={lite ? 2 : 4} kind="storm" /><Drops n={Math.round(rainN * 1.2)} speed={1.9} long={30} /><i className="wx-flash" style={style({ "--dur": "7s", "--delay": "-2s" })} /><i className="wx-bolt" style={style({ "--x": "62%", "--dur": "7s", "--delay": "-2s" })} /></>}
      {kind === "fog" && <><Mist n={lite ? 3 : 5} /></>}
      {kind === "heat" && <><i className="wx-rays" /><i className="wx-sun wx-sun-big" /><i className="wx-heat-glow" /><i className="wx-shimmer" /></>}
      {kind === "cold" && <><i className="wx-frost" /><Flakes n={Math.round(snowN / 2)} big={false} /></>}
      {kind === "snow" && <><i className="wx-frost" /><Flakes n={snowN} big /></>}
    </div>
  );
}
