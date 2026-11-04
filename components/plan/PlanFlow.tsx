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
import { FinishedPlans, PlanHero, PromptChips, TryExamples, WaysIn } from "./StartStep";
import { PlanCard, StepBar, StepTitle, Stepper } from "./chrome";
import { ProposePanel } from "./ProposePanel";
import { PlaceHours } from "@/components/place/PlaceHours";
import type { AroundItem } from "@/lib/place-intel/hours-answer";
import { JourneyPanel } from "./JourneyPanel";
import type { JourneyStop } from "@/lib/intake/journey";
import { distanceKm } from "@/lib/geo";
import { findHub, placeCategoryFor, placeKindFor, type Hub, type Pick as ProposedPick, type ProposedPlan } from "@/lib/intake/propose";
import { VoiceButton } from "./VoiceButton";
import { clock12 } from "@/lib/travel/clock";
import { EXAMPLE_LINKS } from "@/lib/result/example-list";
import { suggestStartDate } from "@/lib/intake/start-date";
import { formatDate } from "@/lib/format";
import { addDays, parseISODate } from "@/lib/dates";
import { DatePicker } from "@/components/ui/DatePicker";

export type Step = "start" | "words" | "understood" | "questions" | "ready";
type Mode = "paste" | "describe" | "manual";
const STEPS: { id: Step; label: string }[] = [{ id: "start", label: "Start" }, { id: "understood", label: "Your places" }, { id: "questions", label: "Questions" }, { id: "ready", label: "Save" }];
const stepIndex = (s: Step) => (s === "words" ? 0 : STEPS.findIndex((x) => x.id === s));

export const EXAMPLES = [
  { text: "4 rojulu Hyderabad nundi, friends tho beaches", lang: "Telugu" },
  { text: "Bangalore se 3 din, doston ke saath, waterfalls aur trekking", lang: "Hinglish" },
  { text: "Gandikota\nBelum Caves\nLepakshi temple", lang: "Reel caption" },
];

const AI_LINE: Record<Exclude<AiState, "idle" | "ok" | "reading">, string> = {
  slow: "The AI didn't answer in time. We used what we could read ourselves; add any missing places with the search below.",
  busy: "The AI is busy right now. We used what we could read ourselves; add any missing places with the search below.",
  limit: "Today's AI reading limit is used up. We used what we could read ourselves; add any missing places with the search below.",
  off: "AI reading isn't switched on here. We used what we could read ourselves; add any missing places with the search below.",
  failed: "The AI couldn't read this. We used what we could read ourselves; add any missing places with the search below.",
  offline: "You're offline, so the AI couldn't read this. We used what we could read ourselves.",
};

const UNBACKED_LABEL: Partial<Record<AnswerKey, string>> = { days: "Days", month: "Month", groupSize: "People", maxDriveHours: "Most driving a day", group: "Who's going", mode: "Travel", pace: "Pace", nightDriving: "Night driving", endMode: "How it ends", stay: "Stay", endSaid: "Ends at", startDate: "Starts on", startTime: "Leaving at" };
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
  /** The place "Plan it for me" is built round. Kept once found, so using a plan (which adds many sights) does not make the panel vanish. */
  const [proposeHub, setProposeHub] = useState<Hub | null>(null);
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

  const foundHub = useMemo(() => findHub(draft.places), [draft.places]);
  useEffect(() => { if (foundHub && !proposeHub) queueMicrotask(() => setProposeHub({ lat: foundHub.lat, lng: foundHub.lng, name: foundHub.name })); }, [foundHub, proposeHub]);

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
    if (!online) { setReadError("You're offline. Reading needs the internet; your text is kept here."); return; }
    setReadError(null); setReading(true); setProposeHub(null);
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

  const pickToDraft = (k: ProposedPick): DraftPlace => ({ key: `you:${k.lat.toFixed(4)},${k.lng.toFixed(4)}`, said: k.name, must: false, source: "said", evidence: "", status: "sure", reason: null, category: placeCategoryFor(k.category), place: { id: k.id, name: k.name, lat: k.lat, lng: k.lng, kind: placeKindFor(k.category), area: k.why[0] ?? null, state: null, source: "osm", km: null, calledAs: null }, alternatives: [] } as DraftPlace);
  const addPicks = (picks: ProposedPick[]) => setDraft((d) => {
    const have = new Set(d.places.map((p) => p.place?.id));
    const fresh = picks.filter((k) => !have.has(k.id)).map(pickToDraft);
    return fresh.length ? { ...d, places: [...d.places, ...fresh] } : d;
  });
  const usePlan = (plan: ProposedPlan) => addPicks(plan.days.flatMap((day) => day.picks));
  const stopToPick = (s: JourneyStop): ProposedPick => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, category: s.category, hubKm: s.alongKm, hubMin: s.driveMin, basis: "road", effort: "easy", notable: s.notable, hours: s.hours, wikipedia: null, why: s.why, source: s.source });
  const addStops = (stops: JourneyStop[]) => addPicks(stops.map(stopToPick));
  // A place to visit in or around the destination town: ADDED next to the town, never in its place.
  const siteId = (i: AroundItem) => (i.osmId ? `osm:${i.osmId}` : i.key);
  const addSite = (i: AroundItem) => setDraft((d) => d.places.some((p) => p.place?.id === siteId(i)) ? d : ({ ...d, places: [...d.places, { key: `you:${i.lat.toFixed(4)},${i.lng.toFixed(4)}`, said: i.name, must: false, source: "said", evidence: "", status: "sure", reason: null, category: placeCategoryFor(i.category), place: { id: siteId(i), name: i.name, lat: i.lat, lng: i.lng, kind: placeKindFor(i.category), area: i.reasons[0] ?? null, state: null, source: "osm", km: null, calledAs: null }, alternatives: [] } as DraftPlace] }));
  const hubPlace = foundHub ? draft.places[foundHub.index]?.place ?? null : null;
  const addedIds = useMemo(() => new Set(draft.places.map((p) => p.place?.id ?? "")), [draft.places]);

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
      if (!p.ok) { setSaving(false); setSaveError(`The trip was saved, but its places weren't: ${p.error} You can add them on the trip's Plan page.`); router.push(`/trips/${t.data.id}/plan`); return; }
    }
    clearDraft();
    router.push(`/trips/${t.data.id}/result`);
  }

  const chosenStart = startDate === undefined ? (eff.answers.startDate && eff.answers.startDate >= todayIndia ? eff.answers.startDate : suggestStartDate(todayIndia, eff.answers.month ?? null)) : startDate;
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
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold transition-colors ${c.source === "default" ? "border-dashed border-ink-soft/40 bg-white text-ink-muted hover:border-teal" : "border-teal bg-teal-light text-teal-ink hover:bg-teal-light/70"}`}>
          {c.text}{c.source === "default" && <span className="sr-only"> (our default)</span>}{c.source === "ai" && <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">AI</span>}
        </button>
      ))}
    </div>
  );

  const warnBox = "rounded-2xl border border-marigold/50 bg-marigold-light/70 px-4 py-3 text-sm text-marigold-ink";
  const noteBox = "flex items-start gap-2 rounded-2xl bg-sky px-4 py-3 text-sm text-ink-muted";

  return (
    <div ref={top} className="mx-auto w-full max-w-2xl scroll-mt-16 px-4 pb-8 pt-2">
      <Stepper steps={STEPS} at={stepIndex(step)} />

      {step === "start" && (
        <div className="space-y-6">
          <PlanHero />
          <PlanCard title="Where does the trip start?" icon="pin">
            <PlaceSearch label="Starting from" value={toPicked(start)} onChange={setStart} currentLocation="auto" recentList="start" placeholder="Your town or area" hint="Used only to plan the route. Your location is used only if you allow it." />
          </PlanCard>
          <WaysIn onPick={(m) => { setMode(m); if (m === "manual") { setDraft((d) => ({ ...d, ai: "idle" })); setStep("understood"); } else setStep("words"); }} />
          <FinishedPlans plans={EXAMPLE_LINKS} />
          <TryExamples examples={EXAMPLES} onPick={(e) => { setText(e.text); setMode(e.lang === "Reel caption" ? "paste" : "describe"); setStep("words"); }} />
        </div>
      )}

      {step === "words" && (
        <section aria-labelledby="h-words" className="space-y-5">
          <StepTitle id="h-words" icon={mode === "paste" ? "paste" : "wand"} kicker="Step 1" title={mode === "paste" ? "Paste what you saw" : "Tell us about the trip"}
            sub={mode === "paste" ? "A reel caption, a list of place names, or a Google Maps link." : "Days, who is going, where from, what you enjoy. Write or say it the way you would tell a friend."} />
          <PlanCard>
            <label htmlFor="trip-words" className="sr-only">{mode === "paste" ? "Place names or caption" : "Your trip, in your words"}</label>
            <textarea id="trip-words" value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} autoFocus
              placeholder={mode === "paste" ? "Gandikota\nBelum Caves\nor the reel's caption" : "e.g. 4 rojulu Hyderabad nundi, friends tho beaches, night driving vaddu"}
              className="w-full resize-y rounded-2xl border-2 border-line bg-sky/50 px-4 py-3.5 text-base leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-soft/70 focus:border-teal focus:bg-white focus:ring-4 focus:ring-teal/20" />
            <p className="mt-1.5 text-right text-xs font-medium text-ink-muted" aria-live="polite">{`${text.length}/4000`}</p>
          </PlanCard>
          {mode === "describe" && <PlanCard><PromptChips text={text} onAdd={(c) => setText((cur) => (cur.trim() ? `${cur.trim()}, ${c.toLowerCase()}` : c).slice(0, 4000))} /></PlanCard>}
          <p className={noteBox}><Glyph name="info" size={16} className="mt-0.5" />We can&apos;t open Instagram or YouTube links. Paste the place names or the caption instead. Google Maps links work.</p>
          <VoiceButton onText={(t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t).slice(0, 4000))} />
          <FormError message={readError} />
          {!online && <p className="text-sm font-semibold text-clay-ink">You&apos;re offline. Reading needs the internet; your text stays here.</p>}
          <StepBar>
            <Button variant="secondary" onClick={() => setStep("start")}>Back</Button>
            <Button onClick={() => void read()} loading={reading} loadingLabel="Reading…" disabled={!text.trim() || !online} className="flex-1">Read it<Glyph name="arrow" size={18} /></Button>
          </StepBar>
        </section>
      )}

      {(step === "understood" || step === "questions") && <div className="mb-5"><FitMeterBar meter={meter} roads={roads} /></div>}

      {step === "understood" && (
        <section aria-labelledby="h-und" className="space-y-5">
          <StepTitle id="h-und" icon="checkCircle" kicker="Step 2" title={mode === "manual" ? "Add your places" : "Here's what we understood"}
            sub={mode === "manual" ? "Search for each place you want to visit." : "Tap a chip to change it. Check the places below, then continue."} />
          {chips.length > 0 && <PlanCard title="Your trip so far" icon="sparkles">{Chips}</PlanCard>}
          {draft.ai === "reading" && <p role="status" className={noteBox}><Spinner /> The AI is reading your text for more place names…</p>}
          {aiLine && (
            <div role="status" className={warnBox}>
              <p className="flex items-start gap-2"><Glyph name="warn" size={16} className="mt-0.5" />{aiLine}</p>
              {draft.ai !== "off" && draft.ai !== "limit" && draft.text && <button type="button" onClick={() => void runAi(draft.text, startBody())} className="tm-action mt-2 min-h-11 font-semibold">Try the AI again</button>}
            </div>
          )}
          {unbacked.length > 0 && (
            <PlanCard>
              <p className="font-bold text-pine">The AI also suggested (not in your words, so not used):</p>
              <ul className="mt-2 space-y-1">{unbacked.map((u) => <li key={`${u.key}-${String(u.value)}`} className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">{unbackedText(u.key as AnswerKey, u.value, thisMonth)} <span className="text-xs">({u.why})</span> <button type="button" onClick={() => choose(u.key as AnswerKey, u.value)} className="tm-action min-h-11 font-semibold">Use it</button></li>)}</ul>
            </PlanCard>
          )}
          {hubPlace && (
            <details className="group rounded-3xl border border-line bg-white p-4 shadow-card">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-1 font-bold text-pine">Opening hours and places to visit in {hubPlace.name}</summary>
              <PlaceHours place={{ name: hubPlace.name, lat: hubPlace.lat, lng: hubPlace.lng, kind: hubPlace.kind, state: hubPlace.state }} date={chosenStart} onAdd={addSite} added={(i) => addedIds.has(siteId(i))} />
            </details>
          )}
          {proposeHub && start && distanceKm(start, proposeHub) >= 80 && (
            <JourneyPanel startDate={chosenStart}
              input={{ start: { lat: start.lat, lng: start.lng, name: start.name }, dest: proposeHub, interests: eff.answers.interests ?? [], maxDriveHours: eff.source.maxDriveHours === "said" || eff.source.maxDriveHours === "you" ? eff.answers.maxDriveHours ?? null : null, roundTrip: eff.answers.endMode !== "place", via: draft.places.filter((p) => p.place?.kind === "state" && p.place.name !== proposeHub.name && p.status !== "missing").map((p) => p.place!.name.replace(/^State of /, "")) }}
              online={online} added={addedIds} onAdd={(s) => addStops([s])} onAddAll={addStops}
            />
          )}
          {proposeHub && (
            <ProposePanel startDate={chosenStart}
              input={{ hub: proposeHub, start: start ? { lat: start.lat, lng: start.lng, name: start.name } : null, roundTrip: eff.answers.endMode !== "place", days: eff.answers.days ?? 3, group: eff.answers.group ?? null, interests: eff.answers.interests ?? [], pace: null, maxDriveHours: eff.source.maxDriveHours === "said" || eff.source.maxDriveHours === "you" ? eff.answers.maxDriveHours ?? null : null }}
              online={online} added={addedIds} onUse={usePlan} onAdd={(k) => addPicks([k])}
              onDays={eff.source.days === "said" || eff.source.days === "you" || eff.source.days === "ai" ? undefined : (n) => choose("days", n)}
            />
          )}
          <PlaceList places={draft.places} near={start ? { lat: start.lat, lng: start.lng } : null} onChange={(places) => setDraft((d) => ({ ...d, places }))} />
          <PlaceSearch label="Add a place" value={null} onChange={addPlace} near={start ? { lat: start.lat, lng: start.lng } : null} recentList="places" placeholder="Search a place to add" preview={false} />
          <SimilarTray online={online} onAdd={addSimilar} input={{ start: start ? { lat: start.lat, lng: start.lng } : null, places: usablePlaces(draft).filter((p) => p.place!.kind !== "state").map((p) => ({ id: p.key, name: p.place!.name, lat: p.place!.lat, lng: p.place!.lng, kind: p.place!.kind, state: p.place!.state, must: p.must })), interests: eff.answers.interests ?? [], month: eff.answers.month ?? null, roundTrip: eff.answers.endMode !== "place" }} />
          <StepBar>
            <Button variant="secondary" onClick={() => setStep(mode === "manual" ? "start" : "words")}>Back</Button>
            <Button onClick={() => setStep(questions.length ? "questions" : "ready")} className="flex-1">Continue<Glyph name="arrow" size={18} /></Button>
          </StepBar>
        </section>
      )}

      {step === "questions" && (
        <section aria-labelledby="h-q" className="space-y-5">
          <StepTitle id="h-q" icon="chat" kicker="Step 3" title={cardsNow.length ? "A few quick questions" : "That's everything"}
            sub={cardsNow.length ? "Each one has an answer ready. Change it or skip." : "You can still change anything on the next screen."} />
          <PlanCard title="Your trip so far" icon="sparkles">{Chips}</PlanCard>
          {seasonLine && <p className={noteBox}><Glyph name="sun" size={16} className="mt-0.5" />{seasonLine}</p>}
          {cardsNow.map((k) => (
            <QuestionCard key={k} k={k} value={eff.answers[k]} source={eff.source[k]} reason={reasonFor(k)} thisMonth={thisMonth} conflict={conflictFor(k)} onAnswer={(v) => choose(k, v)} onSkip={() => skip(k)} />
          ))}
          <button type="button" onClick={() => setStep("ready")} className="tm-action-quiet text-sm">Skip the rest and use the defaults</button>
          <StepBar>
            <Button variant="secondary" onClick={() => setStep("understood")}>Back</Button>
            <Button onClick={() => { setDraft((d) => ({ ...d, skipped: [...new Set([...d.skipped, ...cardsNow])] })); setEditing(null); if (questionsToAsk({ ...draft, skipped: [...draft.skipped, ...cardsNow] }, eff).length === 0) setStep("ready"); }} className="flex-1">
              {cardsNow.length ? "Next" : "Continue"}<Glyph name="arrow" size={18} />
            </Button>
          </StepBar>
        </section>
      )}

      {step === "ready" && (
        <section aria-labelledby="h-ready" className="space-y-5">
          <StepTitle id="h-ready" icon="flag" kicker="Step 4" title="Save your trip" sub="One last look. Dashed chips are our defaults: tap any chip to change it." />
          <FitMeterBar meter={meter} roads={roads} />
          <PlanCard title="Your trip" icon="sparkles">
            {Chips}
            <p className="mt-3 text-sm text-ink-muted">{usablePlaces(draft).length} {usablePlaces(draft).length === 1 ? "place" : "places"}{draft.places.some((p) => p.status === "missing") ? ` (${draft.places.filter((p) => p.status === "missing").length} not found, left out)` : ""}.</p>
          </PlanCard>
          <PlanCard>
            <TextField label="Trip name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={tripRequests(draft, eff).trip.name} hint="Leave it empty to use the suggested name." />
          </PlanCard>
          <PlanCard title="Dates" icon="calendar">
            <fieldset className="space-y-2">
              <legend className="sr-only">Dates</legend>
              {chosenStart !== null ? (
                <>
                  <label htmlFor="plan-start-date" className="block text-sm text-ink-muted">First day{startDate === undefined ? " (our suggestion: change it if you know your dates)" : ""}</label>
                  <DatePicker id="plan-start-date" label="First day" today={todayIndia} min={todayIndia} value={chosenStart} onChange={(v) => setStartDate(v || null)} />
                  {endText && <p className="text-sm font-semibold text-pine">{tripDays} {tripDays === 1 ? "day" : "days"}: {endText}{eff.answers.startTime && (!eff.answers.startDate || eff.answers.startDate === chosenStart) ? ` · leaving ${clock12(eff.answers.startTime)} on day 1` : ""}</p>}
                  <button type="button" onClick={() => setStartDate(null)} className="tm-action min-h-11 text-sm font-semibold">No dates yet</button>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-muted">No dates yet: weather and opening days won&apos;t be checked until you add them.</p>
                  <button type="button" onClick={() => setStartDate(undefined)} className="tm-action min-h-11 text-sm font-semibold">Add dates</button>
                </>
              )}
            </fieldset>
          </PlanCard>
          <FormError message={saveError} />
          {!signedIn && <p className={noteBox}><Glyph name="info" size={16} className="mt-0.5" />Create a free account to save this trip. Your plan stays on this phone while you sign up, and opens here again afterwards.</p>}
          <p className="text-xs text-ink-muted">Once it&apos;s saved, you can ask your group for their pace, interests and things to avoid from the trip&apos;s Plan page.</p>
          <StepBar>
            <Button variant="secondary" onClick={() => setStep("questions")}>Back</Button>
            <Button onClick={() => void planIt()} loading={saving} loadingLabel="Saving your trip…" disabled={!online} className="flex-1">{signedIn ? "Save and plan my trip" : "Sign up and save this trip"}</Button>
          </StepBar>
        </section>
      )}
    </div>
  );
}
