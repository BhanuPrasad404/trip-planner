import { describe, expect, it } from "vitest";
import { LOUD_GAP_MS, PHONE_MAX, PHONE_WINDOW_MS, consider, emptyLedger, planDelivery, recordLoud, recordPhone, type AppAlert, type DeliveryContext } from "@/lib/alerts/delivery";
import { DEFAULT_ALERT_PREFS, clockToMinutes, inQuietHours, minutesToClock, parseAlertPrefs, type AlertPrefs } from "@/lib/alerts/prefs";

/** The real instant when the clock in India (UTC+5:30) reads h:m on 14 Oct 2026. */
const ist = (h: number, m = 0) => Date.UTC(2026, 9, 14, h, m) - 330 * 60_000;
const alert = (o: Partial<AppAlert> = {}): AppAlert => ({ id: "toll:1", kind: "toll", level: 2, title: "Toll plaza ahead", body: "About 4.8 km ahead.", ...o });
const all: AlertPrefs = { enabled: true, phone: true, sound: true, haptics: true, quiet: { startMin: 22 * 60, endMin: 7 * 60 } };
const ctx = (o: Partial<DeliveryContext> = {}): DeliveryContext => ({ nowMs: ist(14), utcOffsetMin: 330, appVisible: true, permission: "granted", canVibrate: true, canBeep: true, ...o });

describe("preferences: damaged saved data never breaks the app", () => {
  it("nothing saved means the defaults: alerts on, phone and sound off, a gentle buzz, quiet at night", () => {
    expect(parseAlertPrefs(null)).toEqual(DEFAULT_ALERT_PREFS);
    expect(DEFAULT_ALERT_PREFS).toMatchObject({ enabled: true, phone: false, sound: false, haptics: true, quiet: { startMin: 1320, endMin: 420 } });
  });
  it("junk, wrong types and half-saved data fall back field by field", () => {
    for (const raw of ["", "{", "[]", "null", "5", '"x"']) expect(parseAlertPrefs(raw)).toEqual(DEFAULT_ALERT_PREFS);
    expect(parseAlertPrefs('{"sound":"yes","phone":true}')).toMatchObject({ sound: false, phone: true });
  });
  it("quiet hours: saved, switched off (null), or rejected when impossible", () => {
    expect(parseAlertPrefs('{"quiet":{"startMin":60,"endMin":120}}').quiet).toEqual({ startMin: 60, endMin: 120 });
    expect(parseAlertPrefs('{"quiet":null}').quiet).toBeNull();
    for (const q of ['{"startMin":5,"endMin":5}', '{"startMin":-1,"endMin":5}', '{"startMin":1500,"endMin":5}', '{"startMin":1.5,"endMin":5}', '"night"']) expect(parseAlertPrefs(`{"quiet":${q}}`).quiet).toEqual(DEFAULT_ALERT_PREFS.quiet);
  });
  it("clock helpers round-trip and reject nonsense", () => {
    expect(minutesToClock(1320)).toBe("22:00"); expect(clockToMinutes("07:05")).toBe(425); expect(clockToMinutes("24:00")).toBeNull(); expect(clockToMinutes("7:5")).toBeNull();
  });
});

describe("quiet hours use the traveller's own clock, including hours that cross midnight", () => {
  const q = { startMin: 22 * 60, endMin: 7 * 60 };
  it("overnight: 10 PM to 7 AM", () => {
    expect(inQuietHours(ist(21, 59), 330, q)).toBe(false); expect(inQuietHours(ist(22, 0), 330, q)).toBe(true); expect(inQuietHours(ist(3), 330, q)).toBe(true);
    expect(inQuietHours(ist(6, 59), 330, q)).toBe(true); expect(inQuietHours(ist(7, 0), 330, q)).toBe(false); expect(inQuietHours(ist(12), 330, q)).toBe(false);
  });
  it("a same-day window, off, and a meaningless empty window", () => {
    expect(inQuietHours(ist(13), 330, { startMin: 12 * 60, endMin: 14 * 60 })).toBe(true); expect(inQuietHours(ist(15), 330, { startMin: 12 * 60, endMin: 14 * 60 })).toBe(false);
    expect(inQuietHours(ist(3), 330, null)).toBe(false); expect(inQuietHours(ist(3), 330, { startMin: 60, endMin: 60 })).toBe(false);
  });
  it("it is the traveller's clock, not the server's: the same instant is night in India and day elsewhere", () => {
    const t = ist(23); // 11 PM in India
    expect(inQuietHours(t, 330, q)).toBe(true); expect(inQuietHours(t, -300, q)).toBe(false); // 12:30 PM in UTC-5
  });
});

describe("delivery: important things, in the right way, only as allowed", () => {
  it("everything off means nothing, not even a card", () => { expect(planDelivery(alert(), { ...all, enabled: false }, ctx())).toMatchObject({ inApp: false, phone: false, sound: false, haptic: false }); });
  it("app open: a card, a tone and a buzz as allowed, but NO phone notification (it would repeat the card)", () => {
    expect(planDelivery(alert(), all, ctx())).toMatchObject({ inApp: true, phone: false, sound: true, haptic: true });
  });
  it("app in the background: a phone notification, no tone (the phone makes its own sound), a buzz", () => {
    expect(planDelivery(alert(), all, ctx({ appVisible: false }))).toMatchObject({ inApp: true, phone: true, sound: false, haptic: true });
  });
  it("phone notifications need the traveller's choice AND the browser's permission", () => {
    expect(planDelivery(alert(), { ...all, phone: false }, ctx({ appVisible: false })).phone).toBe(false);
    for (const permission of ["denied", "default", "unsupported"] as const) {
      const d = planDelivery(alert(), all, ctx({ appVisible: false, permission }));
      expect(d.phone).toBe(false); expect(d.why.join(" ")).toMatch(/blocked|aren't allowed|can't show/);
    }
  });
  it("sound and buzz are separate choices and depend on what the phone can do", () => {
    expect(planDelivery(alert(), { ...all, sound: false }, ctx()).sound).toBe(false);
    expect(planDelivery(alert(), { ...all, haptics: false }, ctx()).haptic).toBe(false);
    expect(planDelivery(alert(), all, ctx({ canVibrate: false })).haptic).toBe(false);
    expect(planDelivery(alert(), all, ctx({ canBeep: false })).sound).toBe(false);
  });
  it("quiet hours silence sound, buzz and phone notifications, but the card still appears", () => {
    const d = planDelivery(alert(), all, ctx({ nowMs: ist(23, 30), appVisible: false }));
    expect(d).toMatchObject({ inApp: true, phone: false, sound: false, haptic: false }); expect(d.why.join(" ")).toContain("Quiet hours");
  });
  it("a critical alert gets through quiet hours; an ordinary one does not", () => {
    expect(planDelivery(alert({ level: 1 }), all, ctx({ nowMs: ist(2), appVisible: false })).phone).toBe(true);
    expect(planDelivery(alert({ level: 2 }), all, ctx({ nowMs: ist(2), appVisible: false })).phone).toBe(false);
  });
  it("suggestions (level 3) are a quiet card only; information (level 4) stays in the list", () => {
    const three = planDelivery(alert({ level: 3 }), all, ctx({ appVisible: false })); expect(three).toMatchObject({ inApp: true, phone: false, sound: false, haptic: false });
    expect(planDelivery(alert({ level: 4 }), all, ctx())).toMatchObject({ inApp: false, phone: false, sound: false, haptic: false });
  });
  it("an alert whose own screen already shows it (the arrival card) skips the banner but can still notify the background phone", () => {
    expect(planDelivery(alert({ kind: "arrival", inApp: false }), all, ctx({ appVisible: false }))).toMatchObject({ inApp: false, phone: true });
    expect(planDelivery(alert({ kind: "arrival", inApp: false }), all, ctx())).toMatchObject({ inApp: false, phone: false });
  });
  it("a test alert works even when alerts are switched off, so the traveller can check", () => { expect(planDelivery(alert({ kind: "test" }), { ...all, enabled: false }, ctx()).inApp).toBe(true); });
});

describe("no repeats, no spam", () => {
  const T = 1_800_000_000_000;
  it("the same alert is announced once, then not again until its cooldown has passed", () => {
    const a = consider(emptyLedger(), alert(), T); expect(a.fire).toBe(true);
    expect(consider(a.ledger, alert(), T + 60_000).fire).toBe(false);
    expect(consider(a.ledger, alert(), T + 29 * 60_000).fire).toBe(false);
    expect(consider(a.ledger, alert(), T + 31 * 60_000).fire).toBe(true);
  });
  it("a different alert is not blocked, and each alert can set its own cooldown (an arrival is per stop for hours)", () => {
    const a = consider(emptyLedger(), alert(), T);
    expect(consider(a.ledger, alert({ id: "toll:2" }), T + 1000).fire).toBe(true);
    const arr = alert({ id: "arrival:s1", cooldownMs: 12 * 3_600_000 }); const b = consider(emptyLedger(), arr, T);
    expect(consider(b.ledger, arr, T + 11 * 3_600_000).fire).toBe(false); expect(consider(b.ledger, arr, T + 13 * 3_600_000).fire).toBe(true);
  });
  it("a test alert always fires", () => { const a = consider(emptyLedger(), alert({ kind: "test", id: "t" }), T); expect(consider(a.ledger, alert({ kind: "test", id: "t" }), T + 1).fire).toBe(true); });
  it("phone notifications are capped: after 3 in 10 minutes the next waits, and it recovers when the window passes", () => {
    let l = emptyLedger(); for (let i = 0; i < PHONE_MAX; i++) l = recordPhone(l, T + i * 1000);
    expect(consider(l, alert({ id: "x" }), T + 5000).phoneOk).toBe(false);
    expect(consider(l, alert({ id: "x" }), T + PHONE_WINDOW_MS + 5000).phoneOk).toBe(true);
    expect(consider(recordPhone(emptyLedger(), T), alert({ id: "y" }), T + 1000).phoneOk).toBe(true);
  });
  it("two sounds or buzzes cannot come within 20 seconds of each other", () => {
    const l = recordLoud(emptyLedger(), T);
    expect(consider(l, alert({ id: "z" }), T + LOUD_GAP_MS - 1).loudOk).toBe(false); expect(consider(l, alert({ id: "z" }), T + LOUD_GAP_MS).loudOk).toBe(true);
  });
  it("the ledger forgets entries older than a day, so it cannot grow all trip", () => {
    const a = consider(emptyLedger(), alert({ id: "old", cooldownMs: 1 }), T);
    const b = consider(a.ledger, alert({ id: "new" }), T + 25 * 3_600_000);
    expect(Object.keys(b.ledger.shown)).toEqual(["new"]);
  });
});
