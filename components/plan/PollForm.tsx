"use client";

// A friend's side of "Ask your group": the trip's name, your name, and 3 quick choices. No sign-up. You can change your answer later
// on the same phone. You never see the trip's places or anyone else's name.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { AVOID_IDS, AVOID_LABEL, type AvoidId } from "@/lib/intake/group";
import { INTERESTS, INTEREST_LABEL, PACES, PACE_LABEL, type Interest, type Pace } from "@/lib/intake/types";

type Info = { status: "open" | "closed" | "invalid"; trip_name?: string; mine: { name: string; answers: { pace?: Pace | null; interests?: Interest[]; avoid?: AvoidId[] } } | null; signedIn: boolean };

const chip = (on: boolean) => `inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 px-3.5 text-sm font-semibold ${on ? "border-teal bg-teal-light/60 text-teal-ink" : "border-line text-ink hover:border-teal/60"}`;

export function PollForm({ code }: { code: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pace, setPace] = useState<Pace | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [avoid, setAvoid] = useState<AvoidId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/poll/${code}`).then(async (r) => {
      const b = (await r.json().catch(() => null)) as (Info & { error?: string }) | null;
      if (!live) return;
      if (!r.ok || !b) { setLoadError(b?.error ?? "Couldn't open this link. Please try again."); return; }
      setInfo(b);
      if (b.mine) { setName(b.mine.name); setPace(b.mine.answers.pace ?? null); setInterests(b.mine.answers.interests ?? []); setAvoid(b.mine.answers.avoid ?? []); }
    }).catch(() => { if (live) setLoadError("No connection. Check your internet and try again."); });
    return () => { live = false; };
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Write your name, so your friends know who answered."); return; }
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/poll/${code}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, answers: { pace, interests, avoid } }) });
      const b = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) { setError(b?.error ?? "Couldn't save your answer. Please try again."); return; }
      setSaved(true);
    } catch { setError("No connection. Your choices are still here; try again."); }
    finally { setSaving(false); }
  }

  if (loadError) return <p role="alert" className="rounded-xl bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">{loadError}</p>;
  if (!info) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  if (info.status === "invalid") return <p className="rounded-xl bg-sky px-4 py-3 text-base">This link isn&apos;t valid any more. Ask the person who shared it for a new one.</p>;
  if (info.status === "closed") return <p className="rounded-xl bg-sky px-4 py-3 text-base">“{info.trip_name}” isn&apos;t taking answers right now.</p>;
  if (saved) return (
    <div role="status" className="rounded-2xl border border-teal/40 bg-teal-light/50 p-5">
      <p className="flex items-center gap-2 font-display text-xl font-semibold text-pine"><Glyph name="checkCircle" size={22} />Thanks, {name.trim()}!</p>
      <p className="mt-1 text-base text-ink-muted">Your answer is saved for “{info.trip_name}”. You can change it from this phone any time with the same link.</p>
      <button type="button" onClick={() => setSaved(false)} className="tm-action mt-2 min-h-11 font-semibold">Change my answer</button>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">Help plan the trip</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-pine">{info.trip_name}</h1>
        <p className="mt-1 text-sm text-ink-muted">Three quick choices. No sign-up. Your friends see your name and your choices, nothing else.</p>
      </div>
      <TextField label="Your name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
      <fieldset><legend className="text-base font-semibold text-ink">What pace suits you?</legend>
        <div role="radiogroup" className="mt-2 flex flex-wrap gap-2">{PACES.map((p) => <button key={p} type="button" role="radio" aria-checked={pace === p} onClick={() => setPace(pace === p ? null : p)} className={chip(pace === p)}>{PACE_LABEL[p]}</button>)}</div>
      </fieldset>
      <fieldset><legend className="text-base font-semibold text-ink">What do you enjoy?</legend>
        <div className="mt-2 flex flex-wrap gap-2">{INTERESTS.map((i) => { const on = interests.includes(i); return <button key={i} type="button" aria-pressed={on} onClick={() => setInterests(on ? interests.filter((x) => x !== i) : [...interests, i])} className={chip(on)}>{on && <Glyph name="check" size={14} strokeWidth={3} />}{INTEREST_LABEL[i]}</button>; })}</div>
      </fieldset>
      <fieldset><legend className="text-base font-semibold text-ink">Anything you&apos;d rather avoid?</legend>
        <div className="mt-2 flex flex-wrap gap-2">{AVOID_IDS.map((a) => { const on = avoid.includes(a); return <button key={a} type="button" aria-pressed={on} onClick={() => setAvoid(on ? avoid.filter((x) => x !== a) : [...avoid, a])} className={chip(on)}>{on && <Glyph name="check" size={14} strokeWidth={3} />}{AVOID_LABEL[a]}</button>; })}</div>
      </fieldset>
      <FormError message={error} />
      <Button type="submit" loading={saving} loadingLabel="Saving…" className="w-full">{info.mine ? "Update my answer" : "Send my answer"}</Button>
      {!info.signedIn && <p className="text-xs text-ink-muted">This phone keeps a small random code so you can change your answer later. No account, no tracking.</p>}
    </form>
  );
}
