// Task 10: every screen prints the SAME distance from the one shared answer, with the same honesty labels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripProgress } from "@/components/TripProgress";
import { ArrivalCard } from "@/components/ArrivalCard";
import { kmText, type Remaining } from "@/lib/trip/remaining";

const base: Remaining = {
  next: { id: "k", name: "Kondapalli Fort", km: 23.4, minutes: 31 }, stops: [{ id: "k", name: "Kondapalli Fort", km: 23.4, minutes: 31 }],
  legs: [{ km: 23.4, minutes: 31 }], totalKm: 23.4, totalMin: 31, covers: 1, coversAll: true, lastName: "Kondapalli Fort",
  basis: "road", gps: "good", exact: true, note: null,
};
const noop = () => undefined;
const screens = (r: Remaining) => {
  const text = kmText(r.next.km, r);
  const progress = renderToStaticMarkup(createElement(TripProgress, { stops: [{ id: "k", name: "Kondapalli Fort", status: "planned" }], vehicle: "car", nextName: "Kondapalli Fort", nextKm: r.next.km, nextKmText: text }));
  const arrival = renderToStaticMarkup(createElement(ArrivalCard, {
    prompt: null, unsure: null, done: { name: "Fort", queued: false, earlier: [] }, progress: { done: 1, total: 2 },
    next: { name: "Kondapalli Fort", km: r.next.km, minutes: r.next.minutes, kmText: text, mapsHref: null }, busy: false,
    onConfirm: noop, onDismiss: noop, onConfirmUnsure: noop, onDismissUnsure: noop, onUndo: noop, onSkipEarlier: noop, onKeepEarlier: noop, onClose: noop, onNavigate: null,
  }));
  return { text, progress, arrival };
};

describe("one number, every screen", () => {
  it("exact road distance", () => {
    const s = screens(base);
    expect(s.text).toBe("23 km");
    expect(s.progress).toContain("23 km");
    expect(s.arrival).toContain("23 km");
  });
  it("weak GPS: every screen says 'about', none shows the precise-looking number", () => {
    const s = screens({ ...base, exact: false, gps: "weak" });
    expect(s.text).toBe("about 25 km");
    for (const html of [s.progress, s.arrival]) { expect(html).toContain("about 25 km"); expect(html).not.toContain("23.4"); expect(html).not.toContain("23 km"); }
  });
  it("routing failed: every screen says 'estimated'", () => {
    const s = screens({ ...base, exact: false, basis: "estimated" });
    for (const html of [s.progress, s.arrival]) expect(html).toContain("(estimated)");
  });
});
