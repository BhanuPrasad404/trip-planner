"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alertPrefsKey, parseAlertPrefs, type AlertPrefs } from "@/lib/alerts/prefs";
import { LOUD_GAP_MS, consider, emptyLedger, planDelivery, recordLoud, recordPhone, type AppAlert, type Permission } from "@/lib/alerts/delivery";
import { buzz, canBeep, canVibrate, notificationPermission, playTone, registerAlertWorker, requestNotificationPermission, showPhoneNotification } from "@/lib/client/alert-channels";
import { useLocalJson } from "@/lib/client/use-local-json";

export type ActiveAlert = AppAlert & { at: number };
const EMPTY = {} as Record<string, never>;
const KEEP = 20;

/**
 * The alert centre for a live trip. `notify` decides, from the traveller's choices and the rules in lib/alerts/delivery.ts, whether and how
 * an alert reaches them: an in-app card, a phone notification (only when the app is in the background), a tone, a buzz. Quiet hours,
 * "don't repeat", and a cap on phone notifications are applied here, in one place, for every kind of alert.
 */
export function useAlerts(utcOffsetMin = 330, opts: { origin?: string } = {}) {
  const [stored, setStored] = useLocalJson<Partial<AlertPrefs>>(alertPrefsKey, EMPTY);
  const prefs = useMemo(() => parseAlertPrefs(JSON.stringify(stored)), [stored]);
  const prefsRef = useRef(prefs);
  const ledger = useRef(emptyLedger());
  const [active, setActive] = useState<ActiveAlert[]>([]);
  const [history, setHistory] = useState<ActiveAlert[]>([]);
  const [permission, setPermission] = useState<Permission>("default");
  const actions = useRef<Map<string, (actionId: string) => void>>(new Map());
  useEffect(() => { prefsRef.current = prefs; });
  useEffect(() => { const t = window.setTimeout(() => setPermission(notificationPermission()), 0); return () => window.clearTimeout(t); }, []);

  const setPrefs = useCallback((next: Partial<AlertPrefs>) => setStored((cur) => ({ ...parseAlertPrefs(JSON.stringify(cur)), ...next })), [setStored]);

  const notify = useCallback((alert: AppAlert, handler?: (actionId: string) => void, o: { test?: boolean } = {}) => {
    const now = Date.now();
    const verdict = consider(ledger.current, alert, now);
    if (!verdict.fire) return false;
    ledger.current = verdict.ledger;
    const test = !!o.test;
    // A test shows what the traveller has switched on, even in quiet hours and with the app open.
    const p = test ? { ...prefsRef.current, quiet: null, enabled: true } : prefsRef.current;
    const visible = typeof document !== "undefined" ? document.visibilityState === "visible" : true;
    const perm = notificationPermission();
    const base = { nowMs: now, utcOffsetMin, permission: perm, canVibrate: canVibrate(), canBeep: canBeep() };
    // A test must show EVERYTHING the traveller switched on. The phone notification only exists while the app is hidden and the tone only
    // while it is open, so a test asks both questions and combines the answers.
    const d = test
      ? { ...planDelivery(alert, p, { ...base, appVisible: true }), phone: planDelivery(alert, p, { ...base, appVisible: false }).phone }
      : planDelivery(alert, p, { ...base, appVisible: visible });
    const phoneAllowed = d.phone && verdict.phoneOk;
    const loudAllowed = verdict.loudOk;

    const entry: ActiveAlert = { ...alert, at: now };
    setHistory((h) => [entry, ...h.filter((x) => x.id !== alert.id)].slice(0, KEEP));
    if (d.inApp || test) {
      setActive((a) => [entry, ...a.filter((x) => x.id !== alert.id)].slice(0, 3));
      if (handler) actions.current.set(alert.id, handler);
      const ttl = alert.ttlMs ?? (alert.level === 3 ? 30_000 : null);
      if (ttl) window.setTimeout(() => setActive((a) => a.filter((x) => x.id !== alert.id || x.at !== now)), ttl); // only THIS showing: a newer one with the same id keeps its own lifetime
    }
    if (phoneAllowed) {
      void showPhoneNotification(alert, { silent: !p.sound, url: opts.origin }).then((ok) => { if (ok) ledger.current = recordPhone(ledger.current, now); });
    }
    let loud = false;
    if (d.sound && loudAllowed) loud = playTone(alert.level) || loud;
    if (d.haptic && loudAllowed) loud = buzz(alert.level) || loud;
    if (loud) ledger.current = recordLoud(ledger.current, now);
    return true;
  }, [utcOffsetMin, opts.origin]);

  const dismiss = useCallback((id: string) => { setActive((a) => a.filter((x) => x.id !== id)); actions.current.delete(id); }, []);
  /** The same alert, changed (a forecast moved): its words are updated where it is shown, quietly: no new buzz, sound or notification. */
  const update = useCallback((alert: AppAlert) => {
    const swap = (list: ActiveAlert[]) => (list.some((x) => x.id === alert.id) ? list.map((x) => (x.id === alert.id ? { ...x, ...alert, at: x.at } : x)) : list);
    setActive(swap); setHistory(swap);
  }, []);
  /**
   * The same alert, become more serious (a weather Warning that is now Severe): its words are updated, plus ONE buzz if the traveller
   * allows buzzing (never a sound or a phone notification), and not closer than the usual gap after another buzz or sound.
   */
  const escalate = useCallback((alert: AppAlert) => {
    update(alert);
    const now = Date.now();
    if (!prefsRef.current.enabled || !prefsRef.current.haptics || !canVibrate() || now - ledger.current.lastLoudAt < LOUD_GAP_MS) return;
    if (buzz(alert.level)) ledger.current = recordLoud(ledger.current, now);
  }, [update]);
  /** An alert that is no longer true (the forecast changed): gone from the screen and from the list. */
  const withdraw = useCallback((id: string) => { setActive((a) => a.filter((x) => x.id !== id)); setHistory((h) => h.filter((x) => x.id !== id)); actions.current.delete(id); }, []);
  const act = useCallback((id: string, actionId: string) => { actions.current.get(id)?.(actionId); dismiss(id); }, [dismiss]);

  /** From a tap on "Turn on phone notifications". Returns what the browser decided. */
  const enablePhone = useCallback(async (): Promise<Permission> => {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") { await registerAlertWorker(); setPrefs({ phone: true }); } else setPrefs({ phone: false });
    return result;
  }, [setPrefs]);

  const sendTest = useCallback(() => notify({ id: `test:${Date.now()}`, kind: "test", level: 2, title: "Test alert", body: "If you can see, hear or feel this, alerts are working.", cooldownMs: 0 }, undefined, { test: true }), [notify]);

  return { prefs, setPrefs, permission, active, history, notify, dismiss, update, escalate, withdraw, act, enablePhone, sendTest };
}
