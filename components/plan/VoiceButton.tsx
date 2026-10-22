"use client";

// Optional voice input: say the trip instead of typing it, in English, Telugu, Hindi, Tamil, Kannada or Marathi. It uses the browser's
// own speech recognition, so it is shown only where the browser has it, and the screen says plainly where the audio goes.
import { useEffect, useRef, useState } from "react";
import { Glyph } from "@/components/ui/Glyph";

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type RecCtor = new () => Rec;

export const VOICE_LANGS = [
  { code: "en-IN", label: "English" }, { code: "te-IN", label: "తెలుగు" }, { code: "hi-IN", label: "हिन्दी" },
  { code: "ta-IN", label: "தமிழ்" }, { code: "kn-IN", label: "ಕನ್ನಡ" }, { code: "mr-IN", label: "मराठी" },
] as const;

export function speechRecognition(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [lang, setLang] = useState<string>("en-IN");
  const [state, setState] = useState<"idle" | "listening" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  useEffect(() => { queueMicrotask(() => setSupported(!!speechRecognition())); }, []);
  useEffect(() => () => rec.current?.stop(), []);
  if (!supported) return null;

  function toggle() {
    if (state === "listening") { rec.current?.stop(); return; }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang; r.interimResults = false; r.continuous = false;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ").trim(); if (t) onText(t); };
    r.onerror = (e) => { setState("error"); setError(e.error === "not-allowed" ? "The microphone is blocked for this site. Allow it in the browser's site settings, or type instead." : e.error === "no-speech" ? "We didn't hear anything. Try again, a little closer to the phone." : "Voice input didn't work this time. You can type instead."); };
    r.onend = () => setState((s) => (s === "listening" ? "idle" : s));
    rec.current = r;
    setError(null); setState("listening");
    try { r.start(); } catch { setState("error"); setError("Voice input didn't start. You can type instead."); }
  }

  return (
    <div className="rounded-xl border border-line bg-sky/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} aria-pressed={state === "listening"} className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-bold ${state === "listening" ? "bg-clay text-white" : "bg-pine text-white"}`}>
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${state === "listening" ? "animate-pulse bg-white" : "bg-marigold"}`} />
          {state === "listening" ? "Listening… tap to stop" : "Say it instead"}
        </button>
        <label className="sr-only" htmlFor="voice-lang">Language you will speak</label>
        <select id="voice-lang" value={lang} onChange={(e) => setLang(e.target.value)} className="min-h-12 rounded-xl border border-line bg-white px-3 text-base">
          {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted"><Glyph name="info" size={13} className="mt-0.5" />Your browser turns speech into text. On Chrome for Android the audio is sent to Google to do that. Nothing is sent until you tap.</p>
      {error && <p role="alert" className="mt-1.5 text-sm font-medium text-clay-ink">{error}</p>}
    </div>
  );
}
