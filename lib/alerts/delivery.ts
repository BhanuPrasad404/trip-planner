// WHEN and HOW an alert reaches the traveller. The goal is "important things, once, at the right time, in the right way", not noise:
//   level 1  critical: gets through quiet hours.            level 2  important and time-sensitive (arrival, a toll ahead).
//   level 3  a helpful suggestion: in the app only.         level 4  information: stays in the list.
// Only levels 1 and 2 may buzz, beep or use a phone notification, and only the channels the traveller allowed. Pure: no browser here.
import { inQuietHours, type AlertPrefs } from "./prefs";

export type AlertLevel = 1 | 2 | 3 | 4;
export type AlertAction = { id: string; label: string };
export type AppAlert = {
  /** Same finding = same id, so it is shown once (for a toll: one id per toll plaza on this route). */
  id: string;
  kind: "arrival" | "toll" | "advice" | "system" | "test" | "weather" | "hours";
  level: AlertLevel;
  title: string;
  /** One short sentence. */
  body: string;
  actions?: AlertAction[];
  /** Show the in-app banner. False when something else on screen already is the in-app alert (the arrival card). */
  inApp?: boolean;
  /** Part of a drive the traveller started (arriving at a stop): quiet hours do not apply. Their own switches still do. */
  duringDrive?: boolean;
  /** Do not announce again until this long has passed. */
  cooldownMs?: number;
  /** Remove the in-app card by itself after this long, if it was not dismissed first (a warning that has stopped being true must not linger). */
  ttlMs?: number;
  /** Never a sound (it may still buzz, if the traveller allows buzzing). Weather alerts while driving. */
  silent?: boolean;
  /** Never a phone notification: it belongs in the app's alert list only. Weather alerts while driving. */
  noPhone?: boolean;
};

export type Permission = "granted" | "denied" | "default" | "unsupported";
export type DeliveryContext = { nowMs: number; utcOffsetMin: number; /** Trailmate is the page the traveller is looking at. */ appVisible: boolean; permission: Permission; canVibrate: boolean; canBeep: boolean };
export type Delivery = { inApp: boolean; phone: boolean; sound: boolean; haptic: boolean; why: string[] };

export function planDelivery(alert: AppAlert, prefs: AlertPrefs, ctx: DeliveryContext): Delivery {
  const none = (why: string): Delivery => ({ inApp: false, phone: false, sound: false, haptic: false, why: [why] });
  if (!prefs.enabled && alert.kind !== "test") return none("Alerts are off");
  const why: string[] = [];
  const important = alert.level <= 2;
  const quiet = inQuietHours(ctx.nowMs, ctx.utcOffsetMin, prefs.quiet) && alert.level > 1 && !alert.duringDrive;
  if (quiet && important) why.push("Quiet hours: no sound, buzz or phone notification");

  const loud = important && !quiet; // the only alerts allowed to use sound, buzz or the phone's notifications
  const inApp = alert.inApp !== false && alert.level <= 3;
  const phone = loud && !alert.noPhone && prefs.phone && ctx.permission === "granted" && !ctx.appVisible;
  if (loud && prefs.phone && ctx.permission !== "granted") why.push(ctx.permission === "denied" ? "Phone notifications are blocked in the browser" : ctx.permission === "unsupported" ? "This browser can't show phone notifications" : "Phone notifications aren't allowed yet");
  if (loud && phone === false && prefs.phone && ctx.permission === "granted" && ctx.appVisible) why.push("The app is open, so no phone notification");
  // While the app is open the traveller is looking at it: a tone or buzz helps when their eyes are on the road. A notification would just repeat the card.
  const sound = loud && !alert.silent && prefs.sound && ctx.appVisible && ctx.canBeep;
  const haptic = loud && prefs.haptics && ctx.canVibrate;
  return { inApp, phone, sound, haptic, why };
}

/** "Don't repeat yourself": remembers what was announced, when, and how many phone notifications went out lately. */
export type Ledger = { shown: Record<string, number>; phoneAt: number[]; lastLoudAt: number };
export const emptyLedger = (): Ledger => ({ shown: {}, phoneAt: [], lastLoudAt: 0 });

export const DEFAULT_COOLDOWN_MS = 30 * 60_000;
/** At most this many phone notifications in the window: a burst of alerts must not turn into spam. */
export const PHONE_MAX = 3;
export const PHONE_WINDOW_MS = 10 * 60_000;
/** Two sounds or buzzes closer together than this are one too many. */
export const LOUD_GAP_MS = 20_000;

export type Verdict = { fire: boolean; reason: string | null; ledger: Ledger; /** Phone notification allowed now (rate limit), separately from the rest. */ phoneOk: boolean; loudOk: boolean };

export function consider(ledger: Ledger, alert: AppAlert, now: number): Verdict {
  const last = ledger.shown[alert.id];
  const cool = alert.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  if (last !== undefined && now - last < cool && alert.kind !== "test") return { fire: false, reason: "Already announced", ledger, phoneOk: false, loudOk: false };
  const recent = ledger.phoneAt.filter((t) => now - t < PHONE_WINDOW_MS);
  const next: Ledger = { shown: { ...ledger.shown, [alert.id]: now }, phoneAt: recent, lastLoudAt: ledger.lastLoudAt };
  // forget very old entries so the ledger cannot grow all day
  for (const [id, t] of Object.entries(next.shown)) if (now - t > 24 * 3_600_000) delete next.shown[id];
  return { fire: true, reason: null, ledger: next, phoneOk: recent.length < PHONE_MAX, loudOk: now - ledger.lastLoudAt >= LOUD_GAP_MS };
}

/** Record that a phone notification / a loud cue really went out. */
export const recordPhone = (l: Ledger, now: number): Ledger => ({ ...l, phoneAt: [...l.phoneAt.filter((t) => now - t < PHONE_WINDOW_MS), now] });
export const recordLoud = (l: Ledger, now: number): Ledger => ({ ...l, lastLoudAt: now });
