import type { Scene } from "@/lib/travel/weather-scene";

/**
 * A quiet layer behind the live weather card. It is there ONLY because the weather data says so (see lib/travel/weather-scene.ts), is
 * hidden from screen readers (the card's own text says the same), never covers the text, uses only transform and opacity, and is
 * switched off by the traveller's "reduce motion" setting or by the "Weather effects" switch.
 */
export function WeatherScene({ scene, on }: { scene: Scene; on: boolean }) {
  if (!on || scene.kind === "clear") return null;
  return (
    <span aria-hidden="true" data-scene={scene.kind} data-intensity={scene.intensity} className={`tm-fx pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl tm-fx-${scene.kind}`}>
      {scene.kind === "rain" && Array.from({ length: scene.drops }, (_, i) => <i key={i} style={{ left: `${4 + ((i * 53) % 92)}%`, animationDelay: `${(i * 211) % 1300}ms`, animationDuration: `${1.5 - scene.intensity * 0.2}s` }} />)}
    </span>
  );
}
