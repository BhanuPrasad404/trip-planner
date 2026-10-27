// Small, pure helpers for showing a traveler: an initial and a colour that never changes for the same person.
// The colours are theme classes (never fixed colour values), so a theme change reaches the avatars too.
export const AVATAR_TONES = ["bg-teal text-white", "bg-clay text-white", "bg-pine text-white", "bg-marigold text-pine"] as const;

export function initialOf(username: string, displayName?: string | null): string {
  const s = (displayName?.trim() || username.trim()).replace(/^@/, "");
  const first = [...s][0];
  return first ? first.toUpperCase() : "?";
}

/** Same name → same colour, on every screen and every visit (a small, stable string hash). */
export function avatarTone(username: string): string {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** "1.2k", "3.4M": counts that fit a small button. */
export function compact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.floor(n));
}
