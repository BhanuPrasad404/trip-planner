import { describe, expect, it } from "vitest";
import { VOICE_PREF_KEY, VOICE_RETRY_AFTER_MS, browserVoiceFailedRecently, browserVoiceUnreliable, forgetBrowserVoiceFailed, rememberBrowserVoiceFailed } from "@/lib/client/voice-prefs";
import { voiceErrorMessage } from "@/lib/client/voice-session";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const NOW = Date.parse("2026-10-27T10:00:00Z");

describe("voice: remember that the browser's recogniser does not work on this phone", () => {
  it("'network' (the case on the phone) and the other can't-work codes count; being quiet or blocked does not", () => {
    for (const c of ["network", "service-not-allowed", "language-not-supported", "start-failed"]) expect(browserVoiceUnreliable(c)).toBe(true);
    for (const c of ["no-speech", "not-allowed", "audio-capture", "aborted"]) expect(browserVoiceUnreliable(c)).toBe(false);
  });
  it("after a failure the next visit prefers recording; after two weeks the browser is tried again", () => {
    const s = mem();
    expect(browserVoiceFailedRecently(s, NOW)).toBe(false);
    rememberBrowserVoiceFailed(s, NOW);
    expect(browserVoiceFailedRecently(s, NOW + 3_600_000)).toBe(true);
    expect(browserVoiceFailedRecently(s, NOW + VOICE_RETRY_AFTER_MS + 1)).toBe(false);
  });
  it("can be switched back on, and a corrupt value never breaks anything", () => {
    const s = mem(); rememberBrowserVoiceFailed(s, NOW); forgetBrowserVoiceFailed(s);
    expect(browserVoiceFailedRecently(s, NOW)).toBe(false);
    s.setItem(VOICE_PREF_KEY, "banana"); expect(browserVoiceFailedRecently(s, NOW)).toBe(false);
    s.setItem(VOICE_PREF_KEY, String(NOW + 10 * 86_400_000)); expect(browserVoiceFailedRecently(s, NOW)).toBe(false); // a clock far in the future is not trusted
  });
  it("a storage that throws (private mode) is survived", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(() => rememberBrowserVoiceFailed(bad, NOW)).not.toThrow();
    expect(browserVoiceFailedRecently(bad, NOW)).toBe(false);
  });
  it("the 'network' message says what to do instead of blaming the connection", () => {
    expect(voiceErrorMessage("network")).toMatch(/record/i);
    expect(voiceErrorMessage("network")).not.toMatch(/check your connection/i);
  });
});
