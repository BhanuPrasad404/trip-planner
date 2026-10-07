// Parsing Google Maps links into coordinates — deterministic, no AI, no API key.
// Short links (maps.app.goo.gl/…) are resolved server-side with a strict host allowlist (anti-SSRF).

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;!?]+$/, "")))];
}

export function stripUrls(text: string): string {
  return text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
}

const MAPS_HOST = /^(?:(?:www|maps)\.)?google\.(?:com|co\.in|in)$/i;
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

export function isShortMapsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return SHORT_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isGoogleMapsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    const host = url.hostname.toLowerCase();
    if (SHORT_HOSTS.has(host)) return true;
    return MAPS_HOST.test(host) && (host.startsWith("maps.") || url.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

const inRange = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export type MapsPin = { lat: number; lng: number; name: string | null };

export function parseMapsUrl(raw: string): MapsPin | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }

  // Name from /maps/place/<name>/…
  let name: string | null = null;
  const nameMatch = /\/maps\/place\/([^/@?]+)/.exec(decoded);
  if (nameMatch) {
    const n = nameMatch[1].replace(/\+/g, " ").trim();
    if (n && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(n)) name = n;
  }

  // Precise place pin (!3d…!4d…) beats the viewport centre (@lat,lng).
  const patterns: RegExp[] = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|ll|query|destination|center)=(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(decoded);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (inRange(lat, lng)) return { lat, lng, name };
    }
  }
  return null;
}

const ALLOWED_REDIRECT_HOST = (host: string) =>
  SHORT_HOSTS.has(host) || MAPS_HOST.test(host);

/**
 * Follows a Google short link a few hops WITHOUT ever fetching a non-allowlisted host.
 * Returns the final URL (to be parsed by parseMapsUrl) or null.
 */
export async function resolveShortMapsUrl(start: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !ALLOWED_REDIRECT_HOST(url.hostname.toLowerCase())) return null;
    if (parseMapsUrl(current)) return current; // already has coordinates, no need to go further

    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Trailmate/1.0)" },
      });
    } catch {
      return null;
    }
    const loc = res.headers.get("location");
    if (!loc) return current;
    current = new URL(loc, current).toString();
  }
  return null;
}
