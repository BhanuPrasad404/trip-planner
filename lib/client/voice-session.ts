// One voice-input session, without React, so every case can be tested with a fake recogniser.
// The browser's recogniser stops by itself at the first pause. A trip description has pauses, so the session starts it again until the
// traveller taps stop (or nothing is heard three times in a row), and hands each finished sentence over as soon as it is final.

export type RecResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
export type RecEvent = { resultIndex?: number; results: ArrayLike<RecResult> };
export type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
};
export type RecCtor = new () => Rec;

export type VoiceHandlers = {
  /** A finished piece of speech (add it to the text). */
  onFinal: (text: string) => void;
  /** The words heard so far in the sentence being spoken (show only; cleared with ""). */
  onInterim: (text: string) => void;
  onListening: (on: boolean) => void;
  /** Voice stopped because of a problem: a plain sentence for the traveller, and the browser's own code (for support). */
  onError: (message: string, code: string) => void;
};

/** Browser error code → what to tell the traveller, in plain words. Unknown codes keep the code so a report can say what happened. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed": return "The microphone is blocked for this site. Allow it in the browser's site settings, then try again, or type instead.";
    case "service-not-allowed": return "This browser won't allow voice input on this page. It usually needs the secure (https) site. You can type instead.";
    case "audio-capture": return "No microphone was found, or another app is using it. Check the microphone and try again.";
    case "network": return "Voice needs the internet: the browser sends your speech to its speech service. Check your connection and try again.";
    case "language-not-supported": return "This browser can't understand that language by voice. Try English, or type instead.";
    case "no-speech": return "We didn't hear anything. Try again, a little closer to the phone.";
    default: return `Voice input stopped (${code}). You can type instead.`;
  }
}

const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]);
/** How many times in a row the recogniser may end with nothing heard before we stop. */
const MAX_EMPTY_RUNS = 3;
/** Hard stop so a forgotten session doesn't listen for ever (counted in recogniser restarts). */
const MAX_RESTARTS = 40;

export function startVoice(Ctor: RecCtor, lang: string, h: VoiceHandlers): { stop: () => void } {
  let wanted = true, emptyRuns = 0, restarts = 0, heard = false, current: Rec | null = null;

  const finish = () => { wanted = false; h.onInterim(""); h.onListening(false); };
  const fail = (code: string) => { finish(); h.onError(voiceErrorMessage(code), code); };

  function begin() {
    const r = new Ctor();
    r.lang = lang; r.interimResults = true; r.continuous = false;
    heard = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const res = e.results[i], text = (res[0]?.transcript ?? "").trim();
        if (!text) continue;
        heard = true; emptyRuns = 0;
        if (res.isFinal) { h.onFinal(text); interim = ""; } else interim = text;
      }
      h.onInterim(interim);
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      if (FATAL.has(e.error)) { fail(e.error); return; }
      if (e.error === "no-speech") return; // handled in onend: tried again a few times, then said plainly
      fail(e.error);
    };
    r.onend = () => {
      if (!wanted) { h.onInterim(""); h.onListening(false); return; }
      if (!heard) emptyRuns++;
      if (emptyRuns >= MAX_EMPTY_RUNS) { fail("no-speech"); return; }
      if (++restarts > MAX_RESTARTS) { finish(); return; }
      h.onInterim("");
      try { begin(); } catch { fail("start-failed"); }
    };
    current = r;
    r.start();
  }

  h.onListening(true);
  try { begin(); } catch { fail("start-failed"); }
  return { stop: () => { if (!wanted) return; wanted = false; try { current?.stop(); } catch { /* already stopped */ } h.onInterim(""); h.onListening(false); } };
}
