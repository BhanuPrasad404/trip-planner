// The ways an alert can reach the traveller outside the page itself. Each one fails quietly: if a browser cannot do it, the in-app card
// is still there. Nothing here runs unless the traveller allowed it, and notification permission is only ever requested from a tap.
import type { AppAlert, Permission } from "@/lib/alerts/delivery";
import { pwaIconPath } from "@/lib/pwa";

export function notificationPermission(): Permission {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    const p = Notification.permission;
    return p === "granted" || p === "denied" ? p : "default";
  } catch {
    return "unsupported";
  }
}

/** MUST be called from a tap. Browsers ignore (or punish) a permission prompt that appears out of nowhere. */
export async function requestNotificationPermission(): Promise<Permission> {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    const r = await Notification.requestPermission();
    return r === "granted" || r === "denied" ? r : "default";
  } catch {
    return "unsupported";
  }
}

/** The worker is needed because phone browsers (Android Chrome) refuse `new Notification()`; they only allow it through a worker. */
export async function registerAlertWorker(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return true;
  } catch {
    return false;
  }
}

export async function showPhoneNotification(alert: AppAlert, opts: { silent: boolean; url?: string }): Promise<boolean> {
  const options: NotificationOptions & { renotify?: boolean } = {
    body: alert.body, tag: alert.id, silent: opts.silent, data: { url: opts.url ?? "/" },
    requireInteraction: alert.level === 1, // only a critical alert stays until dismissed
    icon: pwaIconPath("192"),
  };
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.getRegistration());
      if (reg) { await reg.showNotification(alert.title, options); return true; }
    }
  } catch { /* fall through to the page's own notification */ }
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") { new Notification(alert.title, options); return true; }
  } catch { /* Android Chrome refuses this one: nothing more we can do */ }
  return false;
}

/** A short two-note tone, quiet on purpose. Created on demand and closed again, so it costs no battery while idle. */
export function playTone(level: number): boolean {
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.07;
    gain.connect(ctx.destination);
    const notes = level === 1 ? [880, 660, 880] : [660, 880];
    notes.forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz; o.type = "sine"; o.connect(gain);
      o.start(ctx.currentTime + i * 0.16); o.stop(ctx.currentTime + i * 0.16 + 0.12);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), notes.length * 160 + 300);
    return true;
  } catch {
    return false;
  }
}

export const canBeep = (): boolean => typeof globalThis !== "undefined" && !!((globalThis as unknown as { AudioContext?: unknown }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
export const canVibrate = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
/** Short for an important alert, a longer pattern for a critical one. Never a long buzz while someone is driving. */
export function buzz(level: number): boolean {
  try { return canVibrate() && navigator.vibrate(level === 1 ? [180, 90, 180] : [120]); } catch { return false; }
}
