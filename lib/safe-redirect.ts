// Prevents open-redirect attacks via ?next= parameters.
// Only same-origin, absolute paths are allowed ("/trips", "/trip/abc?x=1").
export function safeNextPath(raw: string | null | undefined, fallback = "/trips"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Browsers strip tabs/newlines and read a backslash as a slash, so "/\t/evil.com" would become "//evil.com".
  if (/[\u0000- \u007f\\]/.test(raw)) return fallback;
  return raw;
}
