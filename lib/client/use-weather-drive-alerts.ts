"use client";

// While driving, the weather alerts that matter NOW go to the app's alert list: Warning or Severe, for the next stop or the road ahead,
// within the next 2 hours (lib/forecast/alerts.ts isDriveAlert). Each one ONCE, with a vibration and no sound, never as a phone
// notification. When the forecast changes, the same alert is updated quietly; going from Warning to Severe gives ONE extra vibration;
// when it is no longer true, it is removed.
import { useEffect, useRef } from "react";
import type { AppAlert } from "@/lib/alerts/delivery";
import { isDriveAlert, type WeatherAlert } from "@/lib/forecast/alerts";
import { time12, INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { SEVERITY_WORD } from "@/lib/weather-rules";

type Channel = { notify: (a: AppAlert) => boolean; update: (a: AppAlert) => void; escalate: (a: AppAlert) => void; withdraw: (id: string) => void };

/** The alert as the alert list shows it. */
export function toAppAlert(a: WeatherAlert, nowMs: number): AppAlert {
  return {
    id: `weather:${a.id}`,
    kind: "weather",
    level: 2,
    title: `${a.label} ${a.role === "road" ? a.place : `at ${a.place}`}`,
    body: `${SEVERITY_WORD[a.level]}: ${a.when}. ${a.detail[0]?.toUpperCase() ?? ""}${a.detail.slice(1)}.${a.advice ? ` ${a.advice}` : ""} ${a.source} forecast for ${time12(a.forecastFor, INDIA_UTC_OFFSET_MIN)}.`,
    duringDrive: true, // part of the drive: a fog warning at night still buzzes (their own switches still apply)
    silent: true,
    noPhone: true,
    cooldownMs: 24 * 3_600_000, // once
    ttlMs: Math.max(5 * 60_000, a.window.to - nowMs), // gone from the screen once it is over
  };
}

export function useWeatherDriveAlerts(alerts: WeatherAlert[], driving: boolean, nowMs: number, channel: Channel) {
  const delivered = useRef(new Map<string, string>()); // app alert id → what was said (to update only when it changed)
  const levels = useRef(new Map<string, WeatherAlert["level"]>()); // app alert id → the level last announced
  const ch = useRef(channel);
  useEffect(() => { ch.current = channel; });

  useEffect(() => {
    const sent = delivered.current;
    if (!driving) {
      for (const id of sent.keys()) ch.current.withdraw(id); // the drive ended: its weather alerts go with it
      sent.clear(); levels.current.clear();
      return;
    }
    const now = new Map(alerts.map((a) => [`weather:${a.id}`, a]));
    // Updated or gone: everything already in the list.
    for (const [id, said] of [...sent]) {
      const a = now.get(id);
      if (!a) { ch.current.withdraw(id); sent.delete(id); levels.current.delete(id); continue; }
      const next = toAppAlert(a, nowMs);
      const text = `${next.title}|${next.body}`;
      const wasSevere = levels.current.get(id) === "severe";
      if (a.level === "severe" && !wasSevere) { ch.current.escalate(next); sent.set(id, text); levels.current.set(id, "severe"); continue; } // Warning → Severe
      if (text !== said) { ch.current.update(next); sent.set(id, text); }
    }
    // New: once each.
    for (const a of alerts) {
      if (!isDriveAlert(a, nowMs)) continue;
      const next = toAppAlert(a, nowMs);
      if (sent.has(next.id)) continue;
      ch.current.notify(next);
      sent.set(next.id, `${next.title}|${next.body}`);
      levels.current.set(next.id, a.level);
    }
  }, [alerts, driving, nowMs]);
}
