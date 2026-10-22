"use client";

// One question as a card of big chips. The current value (a default, or what was read) is shown and pre-selected, and every card can be
// skipped — the shown value then stays. Multi-choice questions (interests, things to avoid) have a "Done" button.
import { useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { AVOID_LABEL } from "@/lib/intake/group";
import { MONTHS } from "@/lib/intake/defaults";
import { paceRules } from "@/lib/trip-builder/recommend";
import { GROUPS, GROUP_LABEL, INTERESTS, INTEREST_LABEL, MODE_LABEL, PACES, PACE_LABEL, STAY_LABEL, STAY_STYLES, TRAVEL_MODES, type AnswerKey, type Source, type TripAnswers } from "@/lib/intake/types";

type Opt = { value: unknown; label: string; hint?: string };
const PACE_STYLE = { relaxed: "relaxed", balanced: "balanced", packed: "explorer" } as const;

/** The question, its options, and whether several can be picked. */
export function questionFor(key: AnswerKey, thisMonth: number): { title: string; options: Opt[]; multi?: boolean; note?: string } | null {
  switch (key) {
    case "month": return { title: "When are you going?", options: Array.from({ length: 12 }, (_, i) => ((thisMonth - 1 + i) % 12) + 1).map((m) => ({ value: m, label: MONTHS[m - 1] })) };
    case "days": return { title: "How many days?", options: [1, 2, 3, 4, 5, 6, 7, 8, 10, 14].map((n) => ({ value: n, label: `${n} ${n === 1 ? "day" : "days"}` })) };
    case "group": return { title: "Who's going?", options: GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] })) };
    case "mode": return { title: "How are you travelling?", options: TRAVEL_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] })), note: "By bus or train we plan around the towns you stay in; check the bus and train times yourself — we don't have timetables." };
    case "pace": return { title: "What pace?", options: PACES.map((p) => ({ value: p, label: PACE_LABEL[p], hint: paceRules(PACE_STYLE[p]).lines[1] })) };
    case "maxDriveHours": return { title: "Most driving in a day?", options: [3, 4, 5, 6, 8].map((h) => ({ value: h, label: `${h} hours` })) };
    case "nightDriving": return { title: "Driving after dark?", options: [{ value: false, label: "No, finish before dark" }, { value: true, label: "Yes, that's fine" }] };
    case "interests": return { title: "What do you enjoy?", multi: true, options: INTERESTS.map((i) => ({ value: i, label: INTEREST_LABEL[i] })) };
    case "stay": return { title: "Where do you like to stay?", options: STAY_STYLES.map((s) => ({ value: s, label: STAY_LABEL[s] })), note: "We show what's on the map near your overnight towns; we don't have prices." };
    case "avoid": return { title: "Anything to avoid?", multi: true, options: Object.values(AVOID_LABEL).map((l) => ({ value: l, label: l })) };
    case "endMode": return { title: "How does the trip end?", options: [{ value: "start", label: "Return to start" }, { value: "place", label: "End at the last place" }, { value: "open", label: "Open-ended" }] };
    default: return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function QuestionCard({ k, value, source, reason, thisMonth, conflict, onAnswer, onSkip }: {
  k: AnswerKey;
  value: TripAnswers[AnswerKey];
  source: Source | undefined;
  /** Why the default (shown under "We'll assume"). */
  reason?: string;
  thisMonth: number;
  /** Our reader and the AI read different things: both are offered. */
  conflict?: { said: unknown; ai: unknown } | null;
  onAnswer: (v: unknown) => void;
  onSkip: () => void;
}) {
  const q = questionFor(k, thisMonth);
  const [picked, setPicked] = useState<unknown[]>(Array.isArray(value) ? value : []);
  if (!q) return null;
  const labelOf = (v: unknown) => q.options.find((o) => same(o.value, v))?.label ?? String(v);
  const id = `q-${k}`;

  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h3 id={id} className="font-display text-lg font-semibold text-pine">{q.title}</h3>
      {conflict && (
        <p className="mt-1 text-sm text-ink-muted">We read “{labelOf(conflict.said)}”, the AI read “{labelOf(conflict.ai)}”. Which is right?</p>
      )}
      {!conflict && value !== undefined && source === "default" && (
        <p className="mt-1 text-sm text-ink-muted"><span className="font-semibold text-ink">We&apos;ll assume: {Array.isArray(value) ? value.map(labelOf).join(", ") : labelOf(value)}.</span>{reason ? ` ${reason}` : ""}</p>
      )}
      <div role={q.multi ? "group" : "radiogroup"} aria-labelledby={id} className="mt-3 flex flex-wrap gap-2">
        {(conflict ? q.options.filter((o) => same(o.value, conflict.said) || same(o.value, conflict.ai)) : q.options).map((o) => {
          const on = q.multi ? picked.some((p) => same(p, o.value)) : same(value, o.value);
          return (
            <button key={String(o.value)} type="button" role={q.multi ? undefined : "radio"} aria-checked={q.multi ? undefined : on} aria-pressed={q.multi ? on : undefined}
              onClick={() => (q.multi ? setPicked((cur) => (cur.some((p) => same(p, o.value)) ? cur.filter((p) => !same(p, o.value)) : [...cur, o.value])) : onAnswer(o.value))}
              className={`inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 px-3.5 text-left text-sm font-semibold ${on ? "border-teal bg-teal-light/60 text-teal-ink" : "border-line text-ink hover:border-teal/60"}`}>
              {on && <Glyph name="check" size={14} strokeWidth={3} />}
              <span>{o.label}{o.hint && <span className="block text-xs font-normal text-ink-muted">{o.hint}</span>}</span>
            </button>
          );
        })}
      </div>
      {q.note && <p className="mt-2 text-xs text-ink-muted">{q.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {q.multi && <button type="button" onClick={() => onAnswer(picked)} className="min-h-11 rounded-xl bg-pine px-4 text-sm font-bold text-white">Done</button>}
        <button type="button" onClick={onSkip} className="min-h-11 px-2 text-sm font-semibold text-ink-muted underline underline-offset-2">Skip{value !== undefined && source === "default" ? " (keep this)" : ""}</button>
      </div>
    </section>
  );
}
