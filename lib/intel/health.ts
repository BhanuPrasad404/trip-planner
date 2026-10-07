// Trip Health: four honest numbers a traveller can read in two seconds.
import type { Advice, HealthTone, TripHealth } from "./types";

type Args = {
  /** Local minute of the day we expect to finish today's stops, or null with no stops. */
  finishMin: number | null;
  nowLocalMin: number;
  dayEndMin: number;
  driveMinutesLeft: number;
  /** First planned stop's delay vs plan (only when comparing with plan). */
  delayMin: number | null;
  hasWeather: boolean;
  advice: Advice[];
};

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function computeHealth(a: Args): TripHealth {
  // Schedule
  let schedule: TripHealth["schedule"];
  if (a.finishMin === null) {
    schedule = { label: "Nothing left", detail: "No stops remaining today.", tone: "unknown" };
  } else {
    const slack = a.dayEndMin - a.finishMin;
    if (a.delayMin !== null && a.delayMin >= 20) schedule = { label: "Behind", detail: `About ${a.delayMin} min behind your plan.`, tone: "bad" };
    else if (slack < 0) schedule = { label: "Over time", detail: `Finishing ${hm(-slack)} after your target.`, tone: "bad" };
    else if (slack < 90) schedule = { label: "Tight", detail: `Only ${hm(slack)} of slack before your target.`, tone: "warn" };
    else schedule = { label: "Comfortable", detail: `${hm(slack)} of slack before your target.`, tone: "good" };
  }

  // Driving load
  const driveTone: HealthTone = a.driveMinutesLeft < 120 ? "good" : a.driveMinutesLeft <= 240 ? "warn" : "bad";
  const driving = { label: a.driveMinutesLeft < 120 ? "Light" : a.driveMinutesLeft <= 240 ? "Moderate" : "Heavy", minutes: a.driveMinutesLeft, tone: driveTone };

  // Weather (only forecast-backed advice counts)
  const wx = a.advice.filter((x) => x.kind === "weather" || x.kind === "daylight");
  let weather: TripHealth["weather"];
  if (!a.hasWeather) weather = { label: "Unknown", detail: "No forecast available for this route right now.", tone: "unknown" };
  else if (wx.some((x) => x.priority >= 80)) weather = { label: "Poor", detail: wx.find((x) => x.priority >= 80)!.title, tone: "bad" };
  else if (wx.length > 0) weather = { label: "Watch", detail: wx[0].title, tone: "warn" };
  else weather = { label: "Good", detail: "No rain, heat or daylight problems expected at your stops.", tone: "good" };

  return { schedule, driving, weather, timeLeftMin: Math.max(0, a.dayEndMin - a.nowLocalMin) };
}
