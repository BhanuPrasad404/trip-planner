// One understanding from the two readers. Rules, in order:
//   1. The traveller's own taps always win (applied later, by the screen: source "you").
//   2. What our instant reader found in the words ("said") stays; if the AI read something DIFFERENT for the same answer, it is a
//      conflict the screen asks about — never silently replaced.
//   3. What only the AI found, backed by the traveller's words, is added ("ai").
//   4. Interests and places are combined (each keeps where it came from); the same place twice is kept once.
import { normalizeName } from "@/lib/places/types";
import type { AiReading } from "./ai-read";
import type { InstantReading } from "./read";
import type { AnswerKey, Known, SaidPlace, Understanding } from "./types";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeReadings(instant: InstantReading, ai: AiReading | null): Understanding {
  const answers: Understanding["answers"] = { ...instant.answers };
  const conflicts: Understanding["conflicts"] = [];
  if (ai) {
    for (const [k, got] of Object.entries(ai.answers) as [AnswerKey, Known<unknown>][]) {
      const mine = (answers as Record<string, Known<unknown> | undefined>)[k];
      if (k === "interests" && mine) {
        const all = [...new Set([...(mine.value as string[]), ...(got.value as string[])])];
        (answers as Record<string, Known<unknown>>)[k] = { ...mine, value: all };
        continue;
      }
      if (k === "startSaid" || k === "endSaid") {
        // Our reader's start is only a guess at the words; the AI's is a cleaned place name: prefer it, the places step checks both.
        if (!mine) (answers as Record<string, Known<unknown>>)[k] = got;
        continue;
      }
      if (!mine) (answers as Record<string, Known<unknown>>)[k] = got;
      else if (!same(mine.value, got.value)) conflicts.push({ key: k, said: mine.value, ai: got.value });
    }
  }
  return { answers, places: mergePlaces(instant.places, ai?.places ?? []), conflicts, unbacked: ai?.unbacked ?? [], scripts: instant.scripts };
}

/** The AI's clean names first (it separates names from sentences best), then our reader's pieces that the AI didn't already cover. */
export function mergePlaces(said: SaidPlace[], ai: SaidPlace[]): SaidPlace[] {
  const out: SaidPlace[] = [...ai];
  for (const p of said) {
    const n = normalizeName(p.said);
    const covered = out.some((o) => { const m = normalizeName(o.said); return m === n || m.includes(n) || n.includes(m) || normalizeName(o.evidence).includes(n); });
    if (!covered) out.push(p);
    else { const o = out.find((x) => normalizeName(x.said) === n); if (o && p.must) o.must = true; }
  }
  return out;
}
