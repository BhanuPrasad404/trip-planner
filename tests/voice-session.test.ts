import { describe, expect, it, vi } from "vitest";
import { startVoice, voiceErrorMessage, type Rec, type RecCtor } from "@/lib/client/voice-session";

function fake() {
  const made: Rec[] = [];
  const Ctor = class implements Rec {
    lang = ""; interimResults = false; continuous = true;
    onresult: Rec["onresult"] = null; onerror: Rec["onerror"] = null; onend: Rec["onend"] = null;
    started = 0; stopped = 0;
    constructor() { made.push(this); }
    start() { this.started++; }
    stop() { this.stopped++; }
  } as unknown as RecCtor;
  return { Ctor, made };
}
const res = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
const handlers = () => ({ onFinal: vi.fn(), onInterim: vi.fn(), onListening: vi.fn(), onError: vi.fn() });

describe("voice session", () => {
  it("starts listening in the chosen language, with live words", () => {
    const { Ctor, made } = fake(); const h = handlers();
    startVoice(Ctor, "te-IN", h);
    expect(made[0].lang).toBe("te-IN"); expect(made[0].interimResults).toBe(true); expect((made[0] as unknown as { started: number }).started).toBe(1);
    expect(h.onListening).toHaveBeenCalledWith(true);
  });
  it("shows words as they come and hands over each finished sentence once", () => {
    const { Ctor, made } = fake(); const h = handlers();
    startVoice(Ctor, "en-IN", h);
    made[0].onresult!({ results: [res("three days from hyd", false)] });
    expect(h.onInterim).toHaveBeenLastCalledWith("three days from hyd"); expect(h.onFinal).not.toHaveBeenCalled();
    made[0].onresult!({ results: [res("three days from hyderabad to goa", true)] });
    expect(h.onFinal).toHaveBeenCalledTimes(1); expect(h.onFinal).toHaveBeenCalledWith("three days from hyderabad to goa");
  });
  it("keeps listening through a pause: the recogniser ending by itself starts it again", () => {
    const { Ctor, made } = fake(); const h = handlers();
    startVoice(Ctor, "en-IN", h);
    made[0].onresult!({ results: [res("go to goa", true)] });
    made[0].onend!();
    expect(made.length).toBe(2); expect((made[1] as unknown as { started: number }).started).toBe(1);
    expect(h.onListening).not.toHaveBeenCalledWith(false);
  });
  it("tap stop ends it for good, with no restart", () => {
    const { Ctor, made } = fake(); const h = handlers();
    const s = startVoice(Ctor, "en-IN", h);
    s.stop(); made[0].onend!();
    expect(made.length).toBe(1); expect(h.onListening).toHaveBeenLastCalledWith(false); expect((made[0] as unknown as { stopped: number }).stopped).toBe(1);
  });
  it("nothing heard three times in a row: stops and says so (no endless loop)", () => {
    const { Ctor, made } = fake(); const h = handlers();
    startVoice(Ctor, "en-IN", h);
    for (let i = 0; i < 3; i++) made[i].onend!();
    expect(made.length).toBe(3);
    expect(h.onError).toHaveBeenCalledWith(voiceErrorMessage("no-speech"), "no-speech");
    expect(h.onListening).toHaveBeenLastCalledWith(false);
  });
  it.each(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"])("%s stops with its own plain message, never a restart", (code) => {
    const { Ctor, made } = fake(); const h = handlers();
    startVoice(Ctor, "en-IN", h);
    made[0].onerror!({ error: code }); made[0].onend!();
    expect(h.onError).toHaveBeenCalledWith(voiceErrorMessage(code), code); expect(made.length).toBe(1);
  });
  it("every known failure has a different message, and an unknown one keeps its code", () => {
    const codes = ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "no-speech"];
    expect(new Set(codes.map(voiceErrorMessage)).size).toBe(codes.length);
    expect(voiceErrorMessage("weird-thing")).toContain("weird-thing");
  });
  it("a start that throws is reported, not swallowed", () => {
    const Bad = class { start() { throw new Error("InvalidStateError"); } stop() {} } as unknown as RecCtor;
    const h = handlers(); startVoice(Bad, "en-IN", h);
    expect(h.onError).toHaveBeenCalled(); expect(h.onListening).toHaveBeenLastCalledWith(false);
  });
});
