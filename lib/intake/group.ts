// "Ask your group": what each friend answered, and where the group agrees and splits. Pure (shared by the server and the screen).
// Each person answers 3 small things: pace, interests, things to avoid. Agreements become the trip's defaults (the owner can still
// change them); splits are shown with both sides, so the owner decides — we never pick a side for them.
import { z } from "zod";
import { INTERESTS, INTEREST_LABEL, PACES, PACE_LABEL, type Interest, type Pace, type TripAnswers } from "./types";

export const AVOID_IDS = ["long_drives", "night_driving", "early_starts", "long_walks", "crowds"] as const;
export type AvoidId = (typeof AVOID_IDS)[number];
export const AVOID_LABEL: Record<AvoidId, string> = { long_drives: "Long drives", night_driving: "Driving at night", early_starts: "Very early starts", long_walks: "Long walks or treks", crowds: "Crowded places" };

export const groupAnswerSchema = z.object({
  pace: z.enum(PACES as [Pace, ...Pace[]]).nullish().transform((v) => v ?? null),
  interests: z.array(z.enum(INTERESTS as [Interest, ...Interest[]])).max(9).default([]).transform((v) => [...new Set(v)]),
  avoid: z.array(z.enum(AVOID_IDS)).max(5).default([]).transform((v) => [...new Set(v)]),
});
export type GroupAnswer = z.infer<typeof groupAnswerSchema>;
export const groupSubmitSchema = z.object({ name: z.string().trim().min(1, "Write your name").max(40, "Keep the name short"), answers: groupAnswerSchema });

/** At least this share of the people who answered must pick the same thing for it to count as "the group agrees". */
export const AGREE_SHARE = 0.75;

export type GroupSummary = {
  count: number;
  /** "All 4: Relaxed" / "3 of 4: Relaxed" lines the group agrees on. */
  agree: string[];
  /** "Split on pace: Relaxed 2 · Packed 2" lines, both sides shown. */
  split: string[];
  /** What the agreements mean for the trip (applied as defaults the owner can change). */
  defaults: Pick<TripAnswers, "pace" | "interests" | "nightDriving" | "avoid">;
};

const of = (n: number, total: number) => (n === total ? `All ${total}` : `${n} of ${total}`);

export function summarizeGroup(rows: { answers: unknown }[]): GroupSummary {
  const answers = rows.map((r) => groupAnswerSchema.safeParse(r.answers)).filter((r) => r.success).map((r) => r.data!);
  const total = answers.length;
  const out: GroupSummary = { count: total, agree: [], split: [], defaults: {} };
  if (total === 0) return out;
  const agrees = (n: number, base = total) => base > 0 && n / base >= AGREE_SHARE;

  // Pace: among those who answered it.
  const paced = answers.filter((a) => a.pace);
  if (paced.length) {
    const votes = PACES.map((p) => ({ p, n: paced.filter((a) => a.pace === p).length })).filter((v) => v.n > 0).sort((a, b) => b.n - a.n);
    if (agrees(votes[0].n, paced.length)) { out.agree.push(`${of(votes[0].n, paced.length)}: ${PACE_LABEL[votes[0].p]} pace`); out.defaults.pace = votes[0].p; }
    else out.split.push(`Split on pace: ${votes.map((v) => `${PACE_LABEL[v.p]} ${v.n}`).join(" · ")}`);
  }
  // Interests: each one on its own.
  const counts = INTERESTS.map((i) => ({ i, n: answers.filter((a) => a.interests.includes(i)).length })).filter((v) => v.n > 0).sort((a, b) => b.n - a.n);
  const liked = counts.filter((v) => agrees(v.n));
  if (liked.length) { out.agree.push(`${liked.map((v) => `${INTEREST_LABEL[v.i]} (${of(v.n, total).toLowerCase()})`).join(", ")}`); out.defaults.interests = liked.map((v) => v.i); }
  const some = counts.filter((v) => !agrees(v.n));
  if (some.length) out.split.push(`Some want: ${some.map((v) => `${INTEREST_LABEL[v.i]} ${v.n} of ${total}`).join(" · ")}`);
  // Things to avoid: one person's "no night driving" matters, so every avoid is shown; agreed ones become rules.
  for (const id of AVOID_IDS) {
    const n = answers.filter((a) => a.avoid.includes(id)).length;
    if (!n) continue;
    if (agrees(n)) {
      out.agree.push(`Avoid ${AVOID_LABEL[id].toLowerCase()} (${of(n, total).toLowerCase()})`);
      if (id === "night_driving") out.defaults.nightDriving = false;
      else (out.defaults.avoid ??= []).push(AVOID_LABEL[id]);
    } else out.split.push(`${of(n, total)} would rather avoid ${AVOID_LABEL[id].toLowerCase()}`);
  }
  return out;
}
