// Height above sea level from Open-Meteo's free elevation service (a global 90 m terrain model). No key, no account.
// Limits worth knowing: values are approximate (a 90 m grid can miss a narrow cutting or a bridge); up to 100 points per request;
// fair-use rate limits apply. It tells us the height of the ground, not the condition of the road.
import type { ElevationProvider } from "./types";

const URL_BASE = "https://api.open-meteo.com/v1/elevation";

export const openMeteoElevation: ElevationProvider = {
  id: "open-meteo",
  maxPoints: 100,
  async elevations(points, fetchImpl = fetch) {
    if (points.length === 0) return [];
    if (points.length > 100) throw new Error("Elevation: at most 100 points per request");
    const lat = points.map((p) => p.lat.toFixed(5)).join(",");
    const lng = points.map((p) => p.lng.toFixed(5)).join(",");
    const res = await fetchImpl(`${URL_BASE}?latitude=${lat}&longitude=${lng}`, { signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Elevation service answered HTTP ${res.status}`);
    const json = (await res.json()) as { elevation?: unknown };
    if (!Array.isArray(json.elevation) || json.elevation.length !== points.length) throw new Error("Elevation service returned an unexpected answer");
    return json.elevation.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  },
};
