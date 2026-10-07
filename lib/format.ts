const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

/** Avatar colours come from the DB (user-editable) — only ever pass through a plain hex. */
export function safeColor(value: string | null | undefined, fallback = "#1C7C6D"): string {
  return value && SAFE_COLOR.test(value) ? value : fallback;
}

export function formatDate(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString("en-IN", opts);
}

export function formatKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
