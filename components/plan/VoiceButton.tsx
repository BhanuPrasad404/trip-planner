"use client";

// Optional voice input: say the trip instead of typing it, in English, Telugu, Hindi, Tamil, Kannada or Marathi. It uses the browser's
// own speech recognition (this app records nothing), so the screen says plainly where the audio goes, shows the words as they are heard,
// keeps listening through pauses until you tap stop, and says exactly why when it can't work.
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

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  // null = not checked yet (server render), so the first paint matches on server and phone.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [lang, setLang] = useState<string>("en-IN");
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The backup: record here, and the server turns the recording into words (when the browser's own recogniser is missing or fails).
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState<number | null>(null);
  const [converting, setConverting] = useState(false);
  // True once the browser's own recogniser has failed on this phone: Record becomes the main button instead of the backup.
  const [preferRecord, setPreferRecord] = useState(false);
  const session = useRef<{ stop: () => void } | null>(null);
  useEffect(() => { queueMicrotask(() => { setSupported(!!speechRecognition()); setCanRecord(recorderSupported()); setPreferRecord(browserVoiceFailedRecently(window.localStorage, Date.now())); }); }, []);
  useEffect(() => () => session.current?.stop(), []);
  if (supported === null) return null;
  if (!supported && !canRecord) {
    return <p className="flex items-start gap-1.5 rounded-xl bg-sky px-3.5 py-2.5 text-sm text-ink-muted"><Glyph name="info" size={15} className="mt-0.5" />Voice input isn&apos;t available in this browser. Chrome on Android or desktop has it, or you can type.</p>;
  }

  async function toggleRecord() {
    if (recording !== null) { session.current?.stop(); return; }
    if (typeof window !== "undefined" && window.isSecureContext === false) { setError("Voice input only works on the secure (https) site, not on a plain http address. You can type instead."); return; }
    setError(null); setHeard(""); setRecording(0);
    session.current = await startRecording({
      onTick: setRecording,
      onError: (m) => { setRecording(null); setError(m); },
      onDone: async (blob) => {
        setRecording(null); setConverting(true);
        const r = await recordingToText(blob, lang);
        setConverting(false);
        if ("error" in r) setError(r.error); else if (r.text) onText(r.text);
      },
    });
  }

  function toggle() {
    if (listening) { session.current?.stop(); return; }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    if (typeof window !== "undefined" && window.isSecureContext === false) { setError("Voice input only works on the secure (https) site, not on a plain http address. You can type instead."); return; }
    setError(null); setHeard("");
    session.current = startVoice(Ctor, lang, {
      onFinal: (t) => onText(t),
      onInterim: setHeard,
      onListening: setListening,
      onError: (message, code) => {
        setError(message);
        if (typeof console !== "undefined") console.warn("[voice]", code);
        // The recogniser can't work on this phone: remember it, so next time Record is the first thing offered.
        if (canRecord && browserVoiceUnreliable(code)) { rememberBrowserVoiceFailed(window.localStorage, Date.now()); setPreferRecord(true); }
      },
    });
  }

  const recordMain = canRecord && (!supported || preferRecord);   // Record is the main button (the browser's own voice is missing or didn't work here)
  const recordLabel = converting ? "Turning your voice into text…" : recording !== null ? `Recording ${Math.floor(recording / 60)}:${String(recording % 60).padStart(2, "0")} · tap to stop` : recordMain ? "Record your voice" : "Record, then convert to text";
  return (
    <div className="rounded-xl border border-line bg-sky/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {supported && !recordMain && (
          <button type="button" onClick={toggle} disabled={recording !== null || converting} aria-pressed={listening} className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-bold disabled:opacity-60 ${listening ? "bg-clay text-white" : "bg-pine text-white"}`}>
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${listening ? "animate-pulse bg-white" : "bg-marigold"}`} />
            {listening ? "Listening… tap to stop" : "Say it instead"}
          </button>
        )}
        {canRecord && (recordMain || error !== null || recording !== null || converting) && (
          <button type="button" onClick={() => void toggleRecord()} disabled={listening || converting} aria-pressed={recording !== null} className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-4 font-bold disabled:opacity-60 ${recording !== null ? "bg-clay text-white" : recordMain ? "bg-pine text-white" : "border-2 border-pine bg-white text-pine"}`}>
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${recording !== null ? "animate-pulse bg-white" : "bg-marigold"}`} />
            {supported && !recordMain && recording === null && !converting ? "Not working? Record instead" : recordLabel}
          </button>
        )}
        <label className="sr-only" htmlFor="voice-lang">Language you will speak</label>
        <span className="min-w-[9rem]"><Select id="voice-lang" label="Language you will speak" value={lang} disabled={listening || recording !== null || converting} onChange={setLang} options={VOICE_LANGS.map((l) => ({ value: l.code, label: l.label }))} /></span>
      </div>
      {listening && <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink">{heard ? <>{heard}</> : <span className="text-ink-muted">Speak now. Pauses are fine; tap stop when you are done.</span>}</p>}
      {recording !== null && <p role="status" aria-live="polite" className="mt-2 text-sm text-ink-muted">Speak now. Pauses are fine; tap stop when you are done.</p>}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted"><Glyph name="info" size={13} className="mt-0.5" />{recordMain ? "Your recording is sent to our speech service to turn it into text, and is not kept." : "Your browser turns speech into text. On Chrome the audio is sent to Google to do that."} Nothing is sent until you tap{canRecord && supported && !recordMain ? "; \"Record instead\" sends a short recording to our speech service, and it is not kept" : ""}.</p>
      {recordMain && supported && recording === null && !converting && <button type="button" onClick={() => { forgetBrowserVoiceFailed(window.localStorage); setPreferRecord(false); setError(null); }} className="tm-action mt-1 min-h-11 text-sm font-semibold">Try live voice again</button>}
      {error && <p role="alert" className="mt-1.5 text-sm font-medium text-clay-ink">{error}</p>}
    </div>
  );
}
