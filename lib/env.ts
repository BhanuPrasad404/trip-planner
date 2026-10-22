// Central, validated access to environment variables.
// NOTE: NEXT_PUBLIC_* values must be referenced as literal `process.env.NEXT_PUBLIC_X`
// so Next.js can inline them into the browser bundle — don't make these dynamic.

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration. Copy .env.local.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return { url, anonKey };
}

/**
 * Open-Meteo (weather). Without a key the FREE API is used, which Open-Meteo allows for NON-COMMERCIAL use only.
 * BEFORE PUBLIC LAUNCH, BUY THE OPEN-METEO COMMERCIAL PLAN AND SET THE KEY (OPEN_METEO_API_KEY). Setting the key is the whole switch:
 * the same requests then go to Open-Meteo's customer servers ("customer-" in front of the host, plus &apikey=). See docs/LAUNCH_CHECKLIST.md.
 * Server-only: never prefix it with NEXT_PUBLIC_.
 */
export function getOpenMeteoConfig(): { forecastUrl: string; archiveUrl: string; apiKey: string | null; commercial: boolean } {
  const apiKey = process.env.OPEN_METEO_API_KEY?.trim() || null;
  const host = (h: string) => `https://${apiKey ? "customer-" : ""}${h}.open-meteo.com/v1`;
  return { forecastUrl: `${host("api")}/forecast`, archiveUrl: `${host("archive-api")}/archive`, apiKey, commercial: !!apiKey };
}

/** `&apikey=…` for Open-Meteo when the commercial key is set, else nothing. */
export const openMeteoKeyParam = (c: { apiKey: string | null }) => (c.apiKey ? `&apikey=${encodeURIComponent(c.apiKey)}` : "");

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}
