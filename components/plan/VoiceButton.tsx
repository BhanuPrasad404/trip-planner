"use client";

// Voice input: say the trip instead of typing it, in English, Telugu, Hindi, Tamil, Kannada or Marathi.
// One big mic button. It uses the browser's own live speech recognition when that works on this phone; when it doesn't (Chrome's voice
// service answers "network" on many Android phones), it records the voice here and our server turns it into words.
// What the traveller always sees: whether the phone can hear them (level bars + timer), a way to cancel, and, if turning the recording
// into text fails, a Try again that re-sends the SAME recording. Nothing they said is lost because a service was busy.
import { useEffect, useRef, useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { Select } from "@/components/ui/Select";
import { recorderSupported, recordingToText, startRecording } from "@/lib/client/voice-record";
import { browserVoiceFailedRecently, browserVoiceUnreliable, forgetBrowserVoiceFailed, rememberBrowserVoiceFailed } from "@/lib/client/voice-prefs";
import { startVoice, type RecCtor } from "@/lib/client/voice-session";

export const VOICE_LANGS = [
  { code: "en-IN", label: "English" }, { code: "te-IN", label: "తెలుగు" }, { code: "hi-IN", label: "हिन्दी" },
  { code: "ta-IN", label: "தமிழ்" }, { code: "kn-IN", label: "ಕನ್ನಡ" }, { code: "mr-IN", label: "मराठी" },
] as const;

export function speechRecognition(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const INSECURE = "Voice input only works on the secure (https) site, not on a plain http address. You can type instead.";
/** Which sentences mean "the recording is fine, the service wasn't": the same recording can be sent again. */
const RETRYABLE = /busy|couldn't turn that into text|No connection|Slow down/i;

/** Five bars that rise with the voice. They sit still (no motion) when the traveller prefers reduced motion. */
function LevelBars({ level }: { level: number }) {
  const heights = [0.45, 0.8, 1, 0.8, 0.45];
  return (
    <span aria-hidden="true" className="flex h-8 items-center gap-1">
      {heights.map((h, i) => <span key={i} className="w-1.5 rounded-full bg-white/90 motion-safe:transition-[height] motion-safe:duration-100" style={{ height: `${Math.round(18 + level * h * 82)}%` }} />)}
    </span>
  );
}

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  // null = not checked yet (server render), so the first paint matches on server and phone.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [lang, setLang] = useState<string>("en-IN");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [converting, setConverting] = useState(false);
  /** True once the browser's own recogniser failed on this phone: recording becomes the way it works from now on. */
  const [preferRecord, setPreferRecord] = useState(false);
  /** The last recording, kept until its words arrive, so a busy service never costs the traveller their speech. */
  const [pending, setPending] = useState<Blob | null>(null);
  const [switched, setSwitched] = useState(false);
  const session = useRef<{ stop: () => void; cancel?: () => void } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; queueMicrotask(() => { setSupported(!!speechRecognition()); setCanRecord(recorderSupported()); setPreferRecord(browserVoiceFailedRecently(window.localStorage, Date.now())); }); return () => { alive.current = false; session.current?.cancel?.(); session.current?.stop(); }; }, []);
  if (supported === null) return <div className="h-24 rounded-2xl border border-line bg-sky/60" aria-hidden="true" />;
  if (!supported && !canRecord) {
    return <p className="flex items-start gap-1.5 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted"><Glyph name="info" size={15} className="mt-0.5" />Voice input isn&apos;t available in this browser. Chrome on Android or desktop has it, or you can type.</p>;
  }

  const useRecord = canRecord && (!supported || preferRecord);
  const busy = listening || recording !== null || converting;

  async function convert(blob: Blob) {
    setPending(blob); setConverting(true); setError(null);
    const r = await recordingToText(blob, lang);
    if (!alive.current) return;
    setConverting(false);
    if ("error" in r) { setError(r.error); if (!RETRYABLE.test(r.error)) setPending(null); return; }
    setPending(null);
    if (r.text) onText(r.text); else setError("We didn't hear anything. Try again, a little closer to the phone.");
  }

  async function startRecord() {
    if (window.isSecureContext === false) { setError(INSECURE); return; }
    setError(null); setHeard(""); setPending(null); setLevel(0); setRecording(0);
    session.current = await startRecording({
      onTick: setRecording,
      onLevel: setLevel,
      onError: (m) => { setRecording(null); setLevel(0); setError(m); },
      onDone: (blob) => { setRecording(null); setLevel(0); void convert(blob); },
    });
  }

  function startLive() {
    const Ctor = speechRecognition();
    if (!Ctor) return;
    if (window.isSecureContext === false) { setError(INSECURE); return; }
    setError(null); setHeard(""); setSwitched(false);
    session.current = startVoice(Ctor, lang, {
      onFinal: (t) => onText(t),
      onInterim: setHeard,
      onListening: setListening,
      onError: (message, code) => {
        console.warn("[voice]", code);
        // This phone's live voice can't work: remember it, and carry on with recording instead of making the traveller work it out.
        if (canRecord && browserVoiceUnreliable(code)) { rememberBrowserVoiceFailed(window.localStorage, Date.now()); setPreferRecord(true); setSwitched(true); setError(null); return; }
        setError(message);
      },
    });
  }

  function main() {
    if (listening || recording !== null) { session.current?.stop(); return; }
    if (converting) return;
    if (useRecord) void startRecord(); else startLive();
  }
  const stateLabel = converting ? "Turning your voice into text…" : recording !== null ? `Recording ${clock(recording)} · tap to finish` : listening ? "Listening · tap to finish" : useRecord ? "Tap and speak" : "Tap and speak";
  const active = listening || recording !== null;

  return (
    <div className="rounded-2xl border border-line bg-sky/60 p-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={main} disabled={converting} aria-pressed={active} aria-label={active ? "Stop and use what you said" : "Start speaking"}
          className={`relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-md outline-none transition-colors focus-visible:ring-4 focus-visible:ring-teal/40 disabled:opacity-60 ${active ? "bg-clay" : "bg-pine"}`}>
          {active && <span aria-hidden="true" className="absolute inset-0 rounded-full bg-clay/40 motion-safe:animate-ping" />}
          <span className="relative">{active && recording !== null ? <LevelBars level={level} /> : <Glyph name={active ? "stop" : "mic"} size={26} />}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p role="status" aria-live="polite" className="text-base font-bold text-pine">{stateLabel}</p>
          <p className="text-sm text-ink-muted">{active ? "Pauses are fine." : converting ? "This takes a few seconds." : "Say the trip in your own words."}</p>
        </div>
        {active && recording !== null && <button type="button" onClick={() => { session.current?.cancel?.(); setRecording(null); setLevel(0); }} className="tm-action min-h-11 shrink-0 px-2 text-sm font-semibold">Cancel</button>}
      </div>

      {listening && <p aria-live="polite" className="mt-2 min-h-5 rounded-lg bg-white/70 px-3 py-2 text-sm text-ink">{heard || <span className="text-ink-muted">Speak now…</span>}</p>}

      <div className="mt-3 flex items-center gap-2">
        <label htmlFor="voice-lang" className="sr-only">Language you will speak</label>
        <span className="min-w-0 flex-1"><Select id="voice-lang" label="Language you will speak" value={lang} disabled={busy} onChange={setLang} options={VOICE_LANGS.map((l) => ({ value: l.code, label: l.label }))} /></span>
      </div>

      {switched && useRecord && !error && <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-ink-muted"><Glyph name="info" size={14} className="mt-0.5" />Live voice didn&apos;t connect on this phone, so we&apos;ll record you instead. Tap the mic again.</p>}
      {error && (
        <div role="alert" className="mt-2 rounded-xl border border-clay/30 bg-clay-light px-3 py-2.5 text-sm font-medium text-clay-ink">
          <p>{error}</p>
          <div className="mt-1 flex flex-wrap gap-x-4">
            {pending && !converting && <button type="button" onClick={() => void convert(pending)} className="tm-action min-h-11 font-bold">Try again with the same recording</button>}
            {!pending && !busy && <button type="button" onClick={main} className="tm-action min-h-11 font-bold">Try again</button>}
          </div>
        </div>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted"><Glyph name="info" size={13} className="mt-0.5" />
        {useRecord ? "Your recording is sent to our speech service to turn it into text, and is not kept." : "Your browser turns speech into text. On Chrome the audio is sent to Google to do that."} Nothing is sent until you tap the mic.
      </p>
      {useRecord && supported && !busy && <button type="button" onClick={() => { forgetBrowserVoiceFailed(window.localStorage); setPreferRecord(false); setSwitched(false); setError(null); }} className="tm-action min-h-11 text-sm font-semibold">Try live voice again</button>}
    </div>
  );
}
