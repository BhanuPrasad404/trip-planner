// Prevents open-redirect attacks via ?next= parameters.
// Only same-origin, absolute paths are allowed ("/trips", "/trip/abc?x=1").
export function safeNextPath(raw: string | null | undefined, fallback = "/trips"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw;
}
