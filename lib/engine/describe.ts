// The plan in plain words, day by day: what the sample-trip printout and the tests read. Every line comes from the plan's numbers.
import { duration, hhmm } from "@/lib/trip-builder/model";
import { fuelCost } from "./fuel";
import type { EnginePlan, Variant } from "./types";

const km = (n: number) => `${Math.round(n)} km`;

export function describeVariant(v: Variant, opts: { fuelPrice?: number | null } = {}): string[] {
  const out: string[] = [];
  out.push(`${v.label}${v.feasible ? "" : " (doesn't fit as asked)"}: ${v.tradeoff}`);
  const days = [
    ...v.transitOut.map((t) => ({ day: t.day, lines: transitLines(t, "Drive day") })),
    ...v.option.days.map((d) => {
      const lines: string[] = [];
      if (!d.stops.length) return { day: d.day, lines: [`Day ${d.day}${d.date ? ` (${d.date})` : ""}: free day (nothing planned).`] };
      lines.push(`Day ${d.day}${d.date ? ` (${d.date})` : ""}: ${duration(d.driveMin)} driving, ${km(d.driveKm)}, ${d.intensity}.`);
      for (const s of d.stops) lines.push(`  ${hhmm(s.arriveMin)} ${s.name} (${duration(s.driveMin)} / ${km(s.driveKm)} from ${s.fromPrev.fromName}; ${duration(s.visitMin)} there)${s.flags.includes("hours_unknown") ? " · hours unknown" : ""}`);
      if (d.returnLeg) lines.push(`  Drive to ${d.returnLeg.to}: ${duration(d.returnLeg.driveMin)} / ${km(d.returnLeg.km)}, there by ${hhmm(d.endMin)}.`);
      const h = v.halts.find((x) => x.day === d.day);
      if (h) lines.push(`  Night halt: ${h.town}${h.area ? `, ${h.area}` : ""}${h.atStop ? "" : ` (about ${km(h.km)}, ${duration(h.driveMin)} — estimated)`}${h.checkStays ? " · small town: check stays here" : ""}.`);
      return { day: d.day, lines };
    }),
    ...v.transitBack.map((t) => ({ day: t.day, lines: transitLines(t, "Drive home") })),
  ].sort((a, b) => a.day - b.day);
  for (const d of days) out.push(...d.lines);
  const t = v.totals;
  const money = fuelCost(t.litres, opts.fuelPrice ?? null);
  out.push(`Total: ${t.days} days, ${t.places} places, ${km(t.km)}, ${duration(t.driveMin)} driving${t.litres !== null ? `, about ${t.litres} L fuel${money !== null ? ` (≈ ₹${money.toLocaleString("en-IN")})` : ""}` : ""}.`);
  if (v.option.removed.length) {
    out.push("Left out:");
    for (const r of v.option.removed) out.push(`  ${r.name}: ${r.reason}`);
  }
  const risks = v.option.warnings.filter((w) => w.severity !== "info");
  for (const w of risks) out.push(`  ! ${w.message}`);
  if (v.needDays) out.push(`Everything fits at this pace in ${v.needDays} days.`);
  return out;
}

function transitLines(t: Variant["transitOut"][number], what: string): string[] {
  const l = [`Day ${t.day}: ${what} ${t.from} → ${t.to}: ${duration(t.driveMin)}, ${km(t.km)}${t.daylightLimited ? " (stops early: no driving after dark)" : ""}.`];
  if (t.haltNote) l.push(`  ${t.haltNote}`);
  return l;
}

export function describePlan(p: EnginePlan, opts: { fuelPrice?: number | null } = {}): string {
  const out: string[] = [];
  out.push(`Recommended: ${p.variants.find((v) => v.id === p.recommended)!.label}`);
  if (p.direction) out.push(`Direction: ${p.direction}`);
  for (const n of p.notes) out.push(`Note: ${n}`);
  for (const w of p.warnings) out.push(`! ${w.message}`);
  for (const v of p.variants) {
    out.push("");
    const same = p.sameAs[v.id];
    if (same) { out.push(`${v.label}: same plan as ${p.variants.find((x) => x.id === same)!.label}.`); continue; }
    out.push(...describeVariant(v, opts));
  }
  const rec = p.variants.find((v) => v.id === p.recommended)!;
  if (rec.whatIf.length) {
    out.push("", `What if (${rec.label}, quick estimate):`);
    for (const w of rec.whatIf) out.push(`  ${w.days} day${w.days === 1 ? "" : "s"}: ${w.places} of ${w.of} places, ${duration(w.driveMin)} driving, ${km(w.km)}${w.fits ? "" : w.places ? " (some left out)" : " (doesn't fit)"}`);
  }
  out.push("", "Labels:");
  for (const l of Object.entries(p.labels).filter(([k]) => k !== "roads")) if (l[1]) out.push(`  ${l[1]}`);
  for (const pm of p.permits) out.push(`  ${pm}`);
  return out.join("\n");
}
