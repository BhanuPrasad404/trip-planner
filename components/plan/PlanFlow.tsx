"use client";

// The guided "plan a trip" flow (Phase 2), phone first: few things per screen, big tap targets, a progress bar, honest messages.
//   1 Start        where you start (fills itself where allowed) + three ways in
//   2 Your words   paste a caption / names, or describe the trip in any language (or say it); reel links can't be opened, so we say so
//   3 Understood   editable chips + places with "Sure" / "Check this" and a one-tap fix + places like these
//   4 Questions    only what's missing, at most 3 at a time, each skippable with its default shown; the fit meter updates live
//   5 Ready        a last look, then "Plan my trip" (a guest signs up here; the plan stays on this phone meanwhile)
// The AI only reads text, in the background: the instant reader answers first, and the AI's status stays visible on screen.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Glyph } from "@/components/ui/Glyph";
import { Spinner } from "@/components/ui/Spinner";
import { useOnline } from "@/lib/client/use-connectivity";
import { useFitMeter } from "@/lib/client/use-fit-meter";
import { clearDraft, loadDraft, saveDraft } from "@/lib/client/plan-draft-store";
import { inSeasonLine, smartDefaults, type InSeason, type MonthClimate } from "@/lib/intake/defaults";
import { effectiveAnswers, emptyDraft, questionsToAsk, summaryChips, tripRequests, usablePlaces, withAi, withInstant, type AiState, type Draft, type DraftPlace } from "@/lib/intake/draft";
import type { MeterPlace } from "@/lib/intake/fit-meter";
import type { Option, PlaceMatch } from "@/lib/intake/places";
import type { Suggestion as Similar } from "@/lib/intake/similar";
import type { AnswerKey, TripAnswers } from "@/lib/intake/types";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";
import { FitMeterBar } from "./FitMeterBar";
import { PlaceList } from "./PlaceList";
import { QuestionCard, questionFor } from "./QuestionCard";
import { SimilarTray } from "./SimilarTray";
import { VoiceButton } from "./VoiceButton";
import Link from "next/link";
import { EXAMPLE_LINKS } from "@/lib/result/example-list";
import { suggestStartDate } from "@/lib/intake/start-date";
import { formatDate } from "@/lib/format";
import { addDays, parseISODate } from "@/lib/dates";

export type Step = "start" | "words" | "understood" | "questions" | "ready";
type Mode = "paste" | "describe" | "manual";
const STEPS: { id: Step; label: string }[] = [{ id: "start", label: "Start" }, { id: "understood", label: "Your places" }, { id: "questions", label: "A few questions" }, { id: "ready", label: "Save" }];
const stepIndex = (s: Step) => (s === "words" ? 0 : STEPS.findIndex((x) => x.id === s));

export const EXAMPLES = [
  { text: "4 rojulu Hyderabad nundi, friends tho beaches", lang: "Telugu" },
  { text: "Bangalore se 3 din, doston ke saath, waterfalls aur trekking", lang: "Hinglish" },
  { text: "📍 Gandikota\n📍 Belum Caves\n📍 Lepakshi temple", lang: "Reel caption" },
];

const AI_LINE: Record<Exclude<AiState, "idle" | "ok" | "reading">, string> = {
  slow: "The AI didn't answer in time. We used what we could read ourselves; add any missing places with the search below.",
  busy: "The AI is busy right now. We used what we could read ourselves; add any missing places with the search below.",
  limit: "Today's AI reading limit is used up. We used what we could read ourselves; add any missing places with the search below.",
  off: "AI reading isn't switched on here. We used what we could read ourselves; add any missing places with the search below.",
  failed: "The AI couldn't read this. We used what we could read ourselves; add any missing places with the search below.",
  offline: "You're offline, so the AI couldn't read this. We used what we could read ourselves.",
};

const UNBACKED_LABEL: Partial<Record<AnswerKey, string>> = { days: "Days", month: "Month", groupSize: "People", maxDriveHours: "Most driving a day", group: "Who's going", mode: "Travel", pace: "Pace", nightDriving: "Night driving", endMode: "How it ends", stay: "Stay", endSaid: "Ends at" };
/** "Month: June" — the AI's unbacked reading, in words, using the same labels as the question cards. */
export function unbackedText(k: AnswerKey, v: unknown, thisMonth: number): string {
  const q = questionFor(k, thisMonth);
  const shown = q?.options.find((o) => JSON.stringify(o.value) === JSON.stringify(v))?.label ?? (k === "groupSize" ? `${v}` : k === "maxDriveHours" ? `${v} hours` : String(v));
  return `${UNBACKED_LABEL[k] ?? k}: ${shown}`;
}

const thisMonthIndia = () => Number(dateOf(Date.now(), INDIA_UTC_OFFSET_MIN).slice(5, 7));
const todayIndiaISO = () => dateOf(Date.now(), INDIA_UTC_OFFSET_MIN);
const toPicked = (o: Option | null): PickedPlace | null => (o ? { name: o.name, address: o.area, lat: o.lat, lng: o.lng, origin: o.id.startsWith("gps") ? "gps" : "search" } : null);
const fromPicked = (p: PickedPlace): Option => ({ id: `${p.origin === "gps" ? "gps" : "pick"}:${p.lat},${p.lng}`, name: p.name, lat: p.lat, lng: p.lng, kind: "place", area: p.address, state: null, source: "osm", km: null, calledAs: null });

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const b = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    return r.ok && b ? { ok: true, data: b } : { ok: false, status: r.status, error: b?.error ?? "Something went wrong. Please try again." };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof DOMException && e.name === "AbortError" ? "aborted" : "Network problem: check your connection and try again." };
  }
}

/** `initial`: start on a given step with a given draft (tests render the save step with it; the app never passes it). */
export function PlanFlow({ signedIn, initial }: { signedIn: boolean; initial?: { draft: Draft; step: Step } }) {
  const router = useRouter();
  const online = useOnline();
  const [step, setStep] = useState<Step>(initial?.step ?? "start");
  const [mode, setMode] = useState<Mode>("describe");
  const [draft, setDraft] = useState<Draft>(initial?.draft ?? emptyDraft);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AnswerKey | null>(null);
  const [season, setSeason] = useState<{ key: string; climate: MonthClimate | null; inSeason: InSeason[] } | null>(null);
  const [name, setName] = useState("");
  /** The save step's first day: undefined = our suggestion, null = "no dates yet". */
  const [startDate, setStartDate] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const aiCtrl = useRef<AbortController | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const thisMonth = useMemo(() => thisMonthIndia(), []);
  const todayIndia = useMemo(() => todayIndiaISO(), []);

  // Coming back from sign-up: the draft was kept on this phone.
  useEffect(() => {
    let resume = false;
    try { resume = new URLSearchParams(window.location.search).get("resume") === "1"; } catch { /* no URL */ }
    if (!resume) return;
    const d = loadDraft();
    if (d) queueMicrotask(() => { setDraft(d); setText(d.text); setStep("ready"); });
  }, []);
  useEffect(() => { top.current?.scrollIntoView?.({ block: "start" }); }, [step]);
  useEffect(() => () => aiCtrl.current?.abort(), []);

  // Answers: your taps > what you wrote > visible defaults.
  const base = useMemo(() => effectiveAnswers(draft, []), [draft]);
  const month = base.answers.month ?? thisMonth;
  const start = draft.start.place;
  const seasonKey = start ? `${start.lat.toFixed(2)},${start.lng.toFixed(2)}|${month}` : "";
  useEffect(() => {
    if (!seasonKey || !online || season?.key === seasonKey) return;
    const c = new AbortController();
    void postJson<{ climate: MonthClimate | null; inSeason: InSeason[] }>("/api/intake/season", { lat: start!.lat, lng: start!.lng, name: start!.name, month }, c.signal)
      .then((r) => { if (r.ok) setSeason({ key: seasonKey, climate: r.data.climate, inSeason: r.data.inSeason }); });
    return () => c.abort();
  }, [seasonKey, online]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers start and month
  const seasonNow = season?.key === seasonKey ? season : null;
  const defaults = useMemo(() => smartDefaults({ answers: base.answers, month, monthSaid: base.answers.month !== undefined, climate: seasonNow?.climate ?? null, inSeason: seasonNow?.inSeason ?? [] }), [base, month, seasonNow]);
  const eff = useMemo(() => effectiveAnswers(draft, defaults), [draft, defaults]);
  const questions = useMemo(() => questionsToAsk(draft, eff), [draft, eff]);
  const chips = useMemo(() => summaryChips(draft, eff), [draft, eff]);

  const meterPlaces = useMemo<MeterPlace[]>(() => usablePlaces(draft).filter((p) => p.place!.kind !== "state").map((p) => ({ id: p.key, name: p.place!.name, lat: p.place!.lat, lng: p.place!.lng, kind: p.place!.kind, must: p.must })), [draft]);
  const { meter, roads } = useFitMeter({ answers: eff.answers, start: start ? { lat: start.lat, lng: start.lng, name: start.name } : null, places: meterPlaces, online });

  const choose = useCallback((k: AnswerKey, v: unknown) => { setDraft((d) => ({ ...d, chosen: { ...d.chosen, [k]: v } as Partial<TripAnswers>, skipped: d.skipped.filter((x) => x !== k) })); setEditing(null); }, []);
  const skip = useCallback((k: AnswerKey) => { setDraft((d) => ({ ...d, skipped: [...new Set([...d.skipped, k])] })); setEditing(null); }, []);
  const setStart = (p: PickedPlace | null) => setDraft((d) => ({ ...d, start: { place: p ? fromPicked(p) : null, from: p ? "you" : null } }));
  const startBody = () => (draft.start.from === "you" && start ? { lat: start.lat, lng: start.lng, name: start.name } : null);

  const runAi = useCallback(async (words: string, startAt: ReturnType<typeof startBody>) => {
    aiCtrl.current?.abort();
    const c = new AbortController(); aiCtrl.current = c;
    if (!online) { setDraft((d) => ({ ...d, ai: "offline" })); return; }
    setDraft((d) => ({ ...d, ai: "reading" }));
    const r = await postJson<{ status: AiState; reading: Parameters<typeof withAi>[2]["reading"]; start: Parameters<typeof withAi>[2]["start"]; places: PlaceMatch[] }>("/api/intake/ai", { text: words, start: startAt }, c.signal);
    if (c.signal.aborted) return;
    setDraft((d) => (r.ok ? withAi(d, null, r.data) : { ...d, ai: r.status === 429 ? "limit" : "failed" }));
  }, [online]);

  async function read() {
    const words = text.trim();
    if (words.length < 2) { setReadError("Write or paste a little more."); return; }
    if (!online) { setReadError("You&apos;re offline. Reading needs the internet; your text is kept here."); return; }
    setReadError(null); setReading(true);
    const startAt = startBody();
    const r = await postJson<{ understanding: Draft["understanding"] & object; start: Draft["start"]; places: PlaceMatch[] }>("/api/intake/read", { text: words, start: startAt });
    setReading(false);
    if (!r.ok) { setReadError(r.error); return; }
    setDraft((d) => withInstant(d, words, r.data));
    setStep("understood");
    void runAi(words, startAt);
  }

  const addPlace = (p: PickedPlace | null) => {
    if (!p) return;
    const o = fromPicked(p);
    setDraft((d) => ({ ...d, places: [...d.places, { key: `you:${o.lat.toFixed(4)},${o.lng.toFixed(4)}`, said: p.name, must: false, source: "said", evidence: "", status: "sure", reason: null, place: o, alternatives: [] } as DraftPlace] }));
  };
  const addSimilar = (s: Similar) => setDraft((d) => ({ ...d, places: [...d.places, { key: `you:${s.lat.toFixed(4)},${s.lng.toFixed(4)}`, said: s.name, must: false, source: "said", evidence: "", status: "sure", reason: null, place: { id: s.id, name: s.name, lat: s.lat, lng: s.lng, kind: s.kind === "temple" || s.kind === "fort" || s.kind === "heritage" || s.kind === "museum" ? "sight" : s.kind === "waterfall" || s.kind === "lake" ? "water" : s.kind === "beach" ? "coast" : s.kind === "peak" || s.kind === "viewpoint" ? "hill" : "place", area: s.reason, state: null, source: "osm", km: null, calledAs: null }, alternatives: [] } as DraftPlace] }));

  async function planIt() {
    setSaveError(null);
    if (!start) { setSaveError("Add where you start first."); setStep("start"); return; }
    if (!signedIn) { saveDraft({ ...draft, text }); router.push(`/signup?next=${encodeURIComponent("/plan?resume=1")}`); return; }
    const req = tripRequests(draft, eff, name, chosenStart);
    setSaving(true);
    const t = await postJson<{ id: string }>("/api/trips", req.trip);
    if (!t.ok) { setSaving(false); setSaveError(t.error); return; }
    if (req.places.length) {
      const p = await postJson<{ added: number }>("/api/places/bulk", { trip_id: t.data.id, places: req.places });
      if (!p.ok) { setSaving(false); setSaveError(`The trip was saved, but its places weren't: ${p.error} You can add them on the trip&apos;s Plan page.`); router.push(`/trips/${t.data.id}/plan`); return; }
    }
    clearDraft();
    router.push(`/trips/${t.data.id}/result`);
  }

  const chosenStart = startDate === undefined ? suggestStartDate(todayIndia, eff.answers.month ?? null) : startDate;
  const tripDays = eff.answers.days ?? 3;
  const endText = chosenStart ? (() => { const a = parseISODate(chosenStart); return a ? `${formatDate(a, { weekday: "short", day: "numeric", month: "short" })} – ${formatDate(addDays(a, tripDays - 1), { weekday: "short", day: "numeric", month: "short" })}` : null; })() : null;
  const aiLine = draft.ai === "reading" ? null : draft.ai in AI_LINE ? AI_LINE[draft.ai as keyof typeof AI_LINE] : null;
  const unbacked = (draft.understanding?.unbacked ?? []).filter((u) => u.key !== "place" && u.key !== "startSaid" && eff.source[u.key as AnswerKey] !== "you");
  const conflictFor = (k: AnswerKey) => draft.understanding?.conflicts.find((c) => c.key === k && draft.chosen[k] === undefined) ?? null;
  const reasonFor = (k: AnswerKey) => defaults.find((s) => s.key === k)?.reason;
  const seasonLine = seasonNow ? inSeasonLine(seasonNow.inSeason, month) : null;
  const cardsNow: AnswerKey[] = editing ? [editing, ...questions.filter((q) => q !== editing)].slice(0, 3) : questions;

  const Chips = (
    <div className="flex flex-wrap gap-2" aria-label="What we understood. Tap one to change it.">
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={() => (c.key === "start" ? setStep("start") : (setEditing(c.key as AnswerKey), setStep("questions")))}
          className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold ${c.source === "default" ? "border-dashed border-line text-ink-muted" : "border-teal bg-teal-light/50 text-teal-ink"}`}>
          {c.text}{c.source === "default" && <span className="sr-only"> (our default)</span>}{c.source === "ai" && <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">AI</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div ref={top} className="mx-auto w-full max-w-2xl scroll-mt-16 px-4 pb-28 pt-2">
      {/* progress */}
      <ol className="mb-4 flex items-center gap-1.5" aria-label="Steps">
        {STEPS.map((s, i) => {
          const at = stepIndex(step);
          return (
            <li key={s.id} className="flex-1" aria-current={i === at ? "step" : undefined}>
              <div className={`h-1.5 rounded-full ${i <= at ? "bg-teal" : "bg-sky"}`} />
              <span className={`mt-1 block text-[11px] font-semibold ${i === at ? "text-teal-ink" : "text-ink-muted"}`}>{s.label}{i < at ? <span className="sr-only"> (done)</span> : null}</span>
            </li>
          );
        })}
      </ol>

      {step === "start" && (
        <section aria-labelledby="h-start" className="space-y-5">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">Plan your trip</p>
            <h1 id="h-start" className="mt-1 font-display text-3xl font-semibold text-pine">Saw some places? Let&apos;s make them a real trip.</h1>
            <p className="mt-1 text-base text-ink-muted">Paste a reel caption, list the places, or just say what you want, in English, Telugu, Hindi, Tamil, Kannada or Marathi.</p>
          </div>
          <PlaceSearch label="Starting from" value={toPicked(start)} onChange={setStart} currentLocation="auto" recentList="start" placeholder="Your town or area" hint="Used only to plan the route. Your location is used only if you allow it." />
          <div className="grid gap-3">
            {([
              ["paste", "I saw these places", "Paste a reel caption or a list of names", "sparkles"],
              ["describe", "Describe my trip", "“4 days from Hyderabad with friends, beaches and food”", "chat"],
              ["manual", "Pick places myself", "Search and add them one by one", "search"],
            ] as const).map(([m, title, sub, icon]) => (
              <button key={m} type="button" onClick={() => { setMode(m); if (m === "manual") { setDraft((d) => ({ ...d, ai: "idle" })); setStep("understood"); } else setStep("words"); }}
                className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left shadow-sm hover:border-teal">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-light text-teal-ink"><Glyph name={icon} size={20} /></span>
                <span><span className="block text-base font-bold text-pine">{title}</span><span className="block text-sm text-ink-muted">{sub}</span></span>
              </button>
            ))}
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">See a finished plan first</p>
            <ul className="mt-2 grid gap-2">{EXAMPLE_LINKS.map((e) => (
              <li key={e.slug}><Link href={`/plan/example/${e.slug}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-white px-4 py-2.5 hover:border-teal">
                <Glyph name="pin" size={18} className="shrink-0 text-teal-ink" />
                <span className="min-w-0"><span className="block font-semibold text-pine">{e.title}</span><span className="block text-sm text-ink-muted">{e.blurb}</span></span>
              </Link></li>
            ))}</ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Or try an example</p>
            <ul className="mt-2 space-y-2">{EXAMPLES.map((e) => (
              <li key={e.text}><button type="button" onClick={() => { setText(e.text); setMode(e.lang === "Reel caption" ? "paste" : "describe"); setStep("words"); }} className="w-full rounded-xl border border-dashed border-line px-3.5 py-2.5 text-left text-sm hover:border-teal"><span className="mr-2 rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{e.lang}</span><span className="whitespace-pre-line">{e.text}</span></button></li>
            ))}</ul>
          </div>
        </section>
      )}

      {step === "words" && (
        <section aria-labelledby="h-words" className="space-y-4">
          <h1 id="h-words" className="font-display text-2xl font-semibold text-pine">{mode === "paste" ? "Paste what you saw" : "Tell us about the trip"}</h1>
          <label htmlFor="trip-words" className="sr-only">{mode === "paste" ? "Place names or caption" : "Your trip, in your words"}</label>
          <textarea id="trip-words" value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={4000} autoFocus
            placeholder={mode === "paste" ? "📍 Gandikota\n📍 Belum Caves\nor the reel's caption…" : "e.g. 4 rojulu Hyderabad nundi, friends tho beaches, night driving vaddu"}
            className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/40" />
          <p className="flex items-start gap-1.5 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted"><Glyph name="info" size={15} className="mt-0.5" />We can&apos;t open Instagram or YouTube links. Paste the place names or the caption instead. Google Maps links work.</p>
          <VoiceButton onText={(t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />
          <FormError message={readError} />
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("start")}>Back</Button>
            <Button onClick={() => void read()} loading={reading} loadingLabel="Reading…" disabled={!text.trim() || !online} className="flex-1">Read it</Button>
          </div>
          {!online && <p className="text-sm font-medium text-clay-ink">You&apos;re offline. Reading needs the internet; your text stays here.</p>}
        </section>
      )}

      {(step === "understood" || step === "questions") && <div className="mb-4"><FitMeterBar meter={meter} roads={roads} /></div>}

      {step === "understood" && (
        <section aria-labelledby="h-und" className="space-y-4">
          <h1 id="h-und" className="font-display text-2xl font-semibold text-pine">{mode === "manual" ? "Add your places" : "Here's what we understood"}</h1>
          {chips.length > 0 && Chips}
          {draft.ai === "reading" && <p role="status" className="flex items-center gap-2 text-sm text-ink-muted"><Spinner /> The AI is reading your text for more place names…</p>}
          {aiLine && (
            <div role="status" className="rounded-xl border border-marigold/50 bg-marigold-light/60 px-3.5 py-2.5 text-sm text-[#7a4a00]">
              <p className="flex items-start gap-1.5"><Glyph name="warn" size={15} className="mt-0.5" />{aiLine}</p>
              {draft.ai !== "off" && draft.ai !== "limit" && draft.text && <button type="button" onClick={() => void runAi(draft.text, startBody())} className="tm-action mt-1 min-h-11 font-semibold">Try the AI again</button>}
            </div>
          )}
          {unbacked.length > 0 && (
            <div className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="font-semibold text-ink">The AI also suggested (not in your words, so not used):</p>
              <ul className="mt-1 space-y-1">{unbacked.map((u) => <li key={`${u.key}-${String(u.value)}`} className="flex flex-wrap items-center gap-2 text-ink-muted">{unbackedText(u.key as AnswerKey, u.value, thisMonth)} <span className="text-xs">({u.why})</span> <button type="button" onClick={() => choose(u.key as AnswerKey, u.value)} className="tm-action min-h-11 font-semibold">Use it</button></li>)}</ul>
            </div>
          )}
          <PlaceList places={draft.places} near={start ? { lat: start.lat, lng: start.lng } : null} onChange={(places) => setDraft((d) => ({ ...d, places }))} />
          <PlaceSearch label="Add a place" value={null} onChange={addPlace} near={start ? { lat: start.lat, lng: start.lng } : null} recentList="places" placeholder="Search a place to add" preview={false} />
          <SimilarTray online={online} onAdd={addSimilar} input={{ start: start ? { lat: start.lat, lng: start.lng } : null, places: usablePlaces(draft).filter((p) => p.place!.kind !== "state").map((p) => ({ id: p.key, name: p.place!.name, lat: p.place!.lat, lng: p.place!.lng, kind: p.place!.kind, state: p.place!.state, must: p.must })), interests: eff.answers.interests ?? [], month: eff.answers.month ?? null, roundTrip: eff.answers.endMode !== "place" }} />
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(mode === "manual" ? "start" : "words")}>Back</Button>
            <Button onClick={() => setStep(questions.length ? "questions" : "ready")} className="flex-1">Continue</Button>
          </div>
        </section>
      )}

      {step === "questions" && (
        <section aria-labelledby="h-q" className="space-y-4">
          <h1 id="h-q" className="font-display text-2xl font-semibold text-pine">{cardsNow.length ? "A few quick questions" : "That's everything"}</h1>
          {Chips}
          {seasonLine && <p className="rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted">{seasonLine}</p>}
          {cardsNow.map((k) => (
            <QuestionCard key={k} k={k} value={eff.answers[k]} source={eff.source[k]} reason={reasonFor(k)} thisMonth={thisMonth} conflict={conflictFor(k)} onAnswer={(v) => choose(k, v)} onSkip={() => skip(k)} />
          ))}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("understood")}>Back</Button>
            <Button onClick={() => { setDraft((d) => ({ ...d, skipped: [...new Set([...d.skipped, ...cardsNow])] })); setEditing(null); if (questionsToAsk({ ...draft, skipped: [...draft.skipped, ...cardsNow] }, eff).length === 0) setStep("ready"); }} className="flex-1">
              {cardsNow.length ? "Next" : "Continue"}
            </Button>
          </div>
          <button type="button" onClick={() => setStep("ready")} className="tm-action min-h-11 text-sm font-semibold">Skip the rest and use the defaults</button>
        </section>
      )}

      {step === "ready" && (
        <section aria-labelledby="h-ready" className="space-y-4">
          <h1 id="h-ready" className="font-display text-2xl font-semibold text-pine">Save your trip</h1>
          <FitMeterBar meter={meter} roads={roads} />
          {Chips}
          <p className="text-sm text-ink-muted">{usablePlaces(draft).length} {usablePlaces(draft).length === 1 ? "place" : "places"}{draft.places.some((p) => p.status === "missing") ? ` (${draft.places.filter((p) => p.status === "missing").length} not found, left out)` : ""}. Dashed chips are our defaults: tap any chip to change it.</p>
          <TextField label="Trip name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={tripRequests(draft, eff).trip.name} hint="Leave it empty to use the suggested name." />
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Dates</legend>
            {chosenStart !== null ? (
              <>
                <label htmlFor="plan-start-date" className="block text-sm text-ink-muted">First day{startDate === undefined ? " (our suggestion: change it if you know your dates)" : ""}</label>
                <input id="plan-start-date" type="date" min={todayIndia} value={chosenStart} onChange={(e) => setStartDate(e.target.value || null)} className="block min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink" />
                {endText && <p className="text-sm text-ink-muted">{tripDays} {tripDays === 1 ? "day" : "days"}: {endText}</p>}
                <button type="button" onClick={() => setStartDate(null)} className="tm-action min-h-11 text-sm font-semibold">No dates yet</button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">No dates yet: weather and opening days won&apos;t be checked until you add them.</p>
                <button type="button" onClick={() => setStartDate(undefined)} className="tm-action min-h-11 text-sm font-semibold">Add dates</button>
              </>
            )}
          </fieldset>
          <FormError message={saveError} />
          {!signedIn && <p className="rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted">Create a free account to save this trip. Your plan stays on this phone while you sign up, and opens here again afterwards.</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("questions")}>Back</Button>
            <Button onClick={() => void planIt()} loading={saving} loadingLabel="Saving your trip…" disabled={!online} className="flex-1">{signedIn ? "Save and plan my trip" : "Sign up and save this trip"}</Button>
          </div>
          <p className="text-xs text-ink-muted">Once it&apos;s saved, you can ask your group for their pace, interests and things to avoid from the trip&apos;s Plan page.</p>
        </section>
      )}
    </div>
  );
}
