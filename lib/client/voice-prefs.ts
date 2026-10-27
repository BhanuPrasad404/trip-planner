// Remembers, on THIS phone, that the browser's own speech recogniser did not work, so the next visit starts with "Record" (our own
// recording, turned into words on the server) instead of making the traveller fail first. Chrome's recogniser needs a working route to
// Google's speech service; on many Android phones, installed apps and some networks it answers "network" every time.
// Only a yes/no and a time is stored. Nothing the traveller said.
export const VOICE_PREF_KEY = "tm:voice:browser-failed";
/** After this long the browser's recogniser is tried again (a network change or an update may have fixed it). */
export const VOICE_RETRY_AFTER_MS = 14 * 24 * 3_600_000;
/** The browser's own error codes that mean "this recogniser can't work here", not "you were quiet". */
const UNRELIABLE = new Set(["network", "service-not-allowed", "language-not-supported", "start-failed"]);

export const browserVoiceUnreliable = (code: string): boolean => UNRELIABLE.has(code);

export function rememberBrowserVoiceFailed(store: Pick<Storage, "setItem">, nowMs: number): void {
  try { store.setItem(VOICE_PREF_KEY, String(nowMs)); } catch { /* private mode: nothing to remember, nothing lost */ }
}
export function forgetBrowserVoiceFailed(store: Pick<Storage, "removeItem">): void {
  try { store.removeItem(VOICE_PREF_KEY); } catch { /* ignore */ }
}
/** True when the browser's recogniser failed recently on this phone. A corrupt or old value counts as "no". */
export function browserVoiceFailedRecently(store: Pick<Storage, "getItem">, nowMs: number): boolean {
  try {
    const at = Number(store.getItem(VOICE_PREF_KEY));
    return Number.isFinite(at) && at > 0 && at <= nowMs + 60_000 && nowMs - at < VOICE_RETRY_AFTER_MS;
  } catch { return false; }
}
