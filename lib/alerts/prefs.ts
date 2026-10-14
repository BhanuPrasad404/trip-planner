// What the traveller allows. Kept on THIS phone (a choice about this device's sound, buzz and notifications), never shared.
import { minuteOfDay } from "@/lib/travel/clock";

export type QuietHours = { startMin: number; endMin: number };
export type AlertPrefs = {
  /** Master switch: off means no alerts of any kind. */
  enabled: boolean;
  /** Also tell me through the phone's notifications when Trailmate is in the background. Needs the phone's permission. */
  phone: boolean;
  /** A short tone when an important alert arrives and the app is open. */
  sound: boolean;
  /** A short buzz for important alerts. */
  haptics: boolean;
  /** No sound, buzz or phone notification during these hours (in-app cards still appear; critical alerts ignore this). Null = never quiet. */
  quiet: QuietHours | null;
};

export const DEFAULT_ALERT_PREFS: AlertPrefs = { enabled: true, phone: false, sound: false, haptics: true, quiet: { startMin: 22 * 60, endMin: 7 * 60 } };
export const alertPrefsKey = "tm:alert-prefs";

const isMin = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440;

/** Anything missing or damaged falls back to the default; it never throws. */
export function parseAlertPrefs(raw: string | null): AlertPrefs {
  if (!raw) return DEFAULT_ALERT_PREFS;
  try {
    const j = JSON.parse(raw) as Partial<AlertPrefs> | null;
    if (!j || typeof j !== "object" || Array.isArray(j)) return DEFAULT_ALERT_PREFS;
    const q = j.quiet;
    const quiet = q === null ? null : q && typeof q === "object" && isMin((q as QuietHours).startMin) && isMin((q as QuietHours).endMin) && (q as QuietHours).startMin !== (q as QuietHours).endMin ? { startMin: (q as QuietHours).startMin, endMin: (q as QuietHours).endMin } : DEFAULT_ALERT_PREFS.quiet;
    return {
      enabled: typeof j.enabled === "boolean" ? j.enabled : DEFAULT_ALERT_PREFS.enabled,
      phone: typeof j.phone === "boolean" ? j.phone : DEFAULT_ALERT_PREFS.phone,
      sound: typeof j.sound === "boolean" ? j.sound : DEFAULT_ALERT_PREFS.sound,
      haptics: typeof j.haptics === "boolean" ? j.haptics : DEFAULT_ALERT_PREFS.haptics,
      quiet,
    };
  } catch {
    return DEFAULT_ALERT_PREFS;
  }
}

/** Is `nowMs` inside the quiet hours, where the clock is the traveller's own (offset from UTC)? Handles hours that cross midnight. */
export function inQuietHours(nowMs: number, utcOffsetMin: number, q: QuietHours | null): boolean {
  if (!q || q.startMin === q.endMin) return false;
  const m = minuteOfDay(nowMs, utcOffsetMin);
  return q.startMin < q.endMin ? m >= q.startMin && m < q.endMin : m >= q.startMin || m < q.endMin;
}

/** "22:00" <-> minutes, for the time inputs. */
export const minutesToClock = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function clockToMinutes(clock: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
