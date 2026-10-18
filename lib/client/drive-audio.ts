// Sounds for a live drive: Trailmate's own arrival chime, a buzz, and the voice. Everything fails quietly: if a browser cannot
// play it, the on-screen card is still there.
//
// Browsers only let a page make sound after the person has tapped something on it (autoplay rules, strict on iPhone). So
// `unlockDriveAudio()` MUST be called from the "Start drive" tap: it creates ONE shared audio context, resumes it and plays a
// silent sound, and primes speech, so the arrival chime and the voice can play later without a tap.
//
// The chime is synthesised here (no audio file, nothing copied): a soft bell timbre (a sine with a quiet octave overtone and a
// fast attack, gentle decay). "Approaching" is two rising notes; "arrived" resolves upward on three notes (G5 – D6 – G6).

type Ctx = AudioContext;
type CtxCtor = new () => Ctx;

let shared: Ctx | null = null;

function ctor(): CtxCtor | null {
  const g = globalThis as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** For tests: forget the shared context. */
export function resetDriveAudio() {
  shared = null;
}

export type AudioUnlock = "running" | "blocked" | "unsupported";

/** Call from the Start-drive tap. Safe to call again (each tap is another chance to unlock). */
export function unlockDriveAudio(): AudioUnlock {
  primeSpeech();
  const C = ctor();
  if (!C) return "unsupported";
  try {
    if (!shared || shared.state === "closed") shared = new C();
    const ctx = shared;
    // A one-sample silent buffer, played inside the tap, is what iOS Safari needs to let later sounds through.
    const buf = ctx.createBuffer(1, 1, 22_050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx.state === "running" ? "running" : "blocked";
  } catch {
    return "unsupported";
  }
}

/** Has a tap unlocked sound on this page? ("blocked" = not yet, or the browser refused). */
export function driveAudioState(): AudioUnlock {
  if (!ctor()) return "unsupported";
  return shared && shared.state === "running" ? "running" : "blocked";
}

function primeSpeech() {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // An empty, silent utterance inside the tap lets later announcements speak on iPhone.
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* speech is optional */ }
}

export type ChimeKind = "approach" | "arrived";

/** Notes in Hz and their start offsets (s). Exported so a test can prove the two cues differ. */
export const CHIME: Record<ChimeKind, { hz: number; at: number; len: number }[]> = {
  approach: [{ hz: 659.25, at: 0, len: 0.35 }, { hz: 987.77, at: 0.14, len: 0.45 }],
  arrived: [{ hz: 783.99, at: 0, len: 0.4 }, { hz: 1174.66, at: 0.16, len: 0.4 }, { hz: 1567.98, at: 0.32, len: 0.9 }],
};

/** Plays the chime on the unlocked context. Returns false when it could not (no tap yet, no audio, suspended). */
export function playChime(kind: ChimeKind): boolean {
  const ctx = shared;
  if (!ctx || ctx.state !== "running") {
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return false;
  }
  try {
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    for (const n of CHIME[kind]) {
      // A bell: the note plus a quieter octave above it, both with a quick attack and an exponential fade.
      for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = n.hz * mult;
        g.gain.setValueAtTime(0.0001, t0 + n.at);
        g.gain.exponentialRampToValueAtTime(level, t0 + n.at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
        o.connect(g);
        g.connect(master);
        o.start(t0 + n.at);
        o.stop(t0 + n.at + n.len + 0.05);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Short and distinct; never a long buzz while someone is driving. */
export const VIBRATION: Record<ChimeKind, number[]> = { approach: [90], arrived: [160, 90, 160] };

export function vibrate(kind: ChimeKind): boolean {
  try {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && navigator.vibrate(VIBRATION[kind]);
  } catch {
    return false;
  }
}
