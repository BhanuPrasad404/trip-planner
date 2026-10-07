// Sunrise / sunset from the NOAA algorithm — pure maths, no provider or network needed.
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mod = (n: number, m: number) => ((n % m) + m) % m;

function eventUtcHours(lat: number, lng: number, dayOfYear: number, rising: boolean): number | null {
  const lngHour = lng / 15;
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  const L = mod(M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634, 360);
  let RA = mod(deg(Math.atan(0.91764 * Math.tan(rad(L)))), 360);
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(90.833)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null; // sun never rises / never sets here today
  const H = (rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return mod(T - lngHour, 24);
}

export type SunTimes = { sunriseMin: number; sunsetMin: number } | null;

/** Minutes after LOCAL midnight (for a clock `utcOffsetMin` ahead of UTC) on the local date containing `utcMs`. */
export function sunTimes(lat: number, lng: number, utcMs: number, utcOffsetMin: number): SunTimes {
  const local = new Date(utcMs + utcOffsetMin * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - start) / 86_400_000);
  const rise = eventUtcHours(lat, lng, dayOfYear, true);
  const set = eventUtcHours(lat, lng, dayOfYear, false);
  if (rise === null || set === null) return null;
  const toLocal = (h: number) => mod(Math.round(h * 60 + utcOffsetMin), 1440);
  return { sunriseMin: toLocal(rise), sunsetMin: toLocal(set) };
}
