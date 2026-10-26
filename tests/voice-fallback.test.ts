// The backup for voice input: a recording is written as a plain WAV, checked on the server, and turned into words. Every failure has its own sentence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTranscribeRequest, textOf, transcribeGemini } from "@/lib/ai/transcribe";
import { AiNotConfiguredError, AiRequestError } from "@/lib/ai/types";
import { MAX_RECORD_SECONDS, bytesToBase64, encodeWav, readWavHeader } from "@/lib/client/wav";
import { micErrorMessage, transcribeMessage } from "@/lib/client/voice-record";
import { MAX_AUDIO_BASE64_CHARS, transcribeVoice, intakeVoiceSchema } from "@/lib/intake/voice-service";

const wav = (seconds: number, rate = 16_000) => bytesToBase64(encodeWav(new Float32Array(Math.round(seconds * rate)).map((_, i) => Math.sin(i / 20) * 0.3), rate));
const deps = (over: Partial<Parameters<typeof transcribeVoice>[1]> = {}) => ({ transcribe: vi.fn(async () => "3 days from Hyderabad to Goa"), allow: vi.fn(async () => true), available: true, ...over });

describe("WAV writing", () => {
  it("makes a valid 16 kHz mono 16-bit file whose header matches its length", () => {
    const bytes = encodeWav(new Float32Array(16_000));
    const h = readWavHeader(bytes)!;
    expect(h).toMatchObject({ sampleRate: 16_000, channels: 1, bits: 16, dataBytes: 32_000 });
    expect(h.seconds).toBeCloseTo(1, 5); expect(bytes.length).toBe(44 + 32_000);
  });
  it("clips loud samples instead of wrapping them round", () => {
    const b = encodeWav(Float32Array.from([2, -2, 0.5]));
    const v = new DataView(b.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff); expect(v.getInt16(46, true)).toBe(-0x8000); expect(Math.abs(v.getInt16(48, true) - 16383)).toBeLessThanOrEqual(1);
  });
  it("refuses anything that is not a plain PCM WAV", () => {
    expect(readWavHeader(new Uint8Array(10))).toBeNull();
    expect(readWavHeader(new TextEncoder().encode("ID3 this is an mp3 not a wav file at all, honest ...........".repeat(2)))).toBeNull();
    const notPcm = encodeWav(new Float32Array(100)); notPcm[20] = 3; // format tag 3 = float
    expect(readWavHeader(notPcm)).toBeNull();
  });
  it("base64 round-trips big arrays without blowing the stack", () => {
    const big = new Uint8Array(500_000).map((_, i) => i % 251);
    expect(Uint8Array.from(Buffer.from(bytesToBase64(big), "base64"))).toEqual(big);
  });
  it("the size limits fit together: the longest recording is under the server's cap", () => {
    expect(wav(MAX_RECORD_SECONDS).length).toBeLessThanOrEqual(MAX_AUDIO_BASE64_CHARS);
  });
});

describe("the server's checks and answers", () => {
  it("turns a good recording into words", async () => {
    const d = deps();
    const r = await transcribeVoice({ audio: wav(3), lang: "te-IN" }, d);
    expect(r).toEqual({ status: "ok", text: "3 days from Hyderabad to Goa" });
    expect(d.transcribe).toHaveBeenCalledWith(expect.objectContaining({ languageName: "Telugu" }));
  });
  it("says 'off' when there is no speech service here, without calling anything", async () => {
    const d = deps({ available: false });
    expect(await transcribeVoice({ audio: wav(2), lang: "en-IN" }, d)).toEqual({ status: "off", text: "" });
    expect(d.transcribe).not.toHaveBeenCalled(); expect(d.allow).not.toHaveBeenCalled();
  });
  it("passes on nothing but a real WAV of sensible length", async () => {
    const d = deps();
    const junk = Buffer.from("not audio at all ".repeat(40)).toString("base64");
    expect((await transcribeVoice({ audio: junk, lang: "en-IN" }, d)).status).toBe("bad_audio");
    expect((await transcribeVoice({ audio: "%%%not-base64%%%".repeat(20), lang: "en-IN" }, d)).status).toBe("bad_audio");
    expect((await transcribeVoice({ audio: wav(MAX_RECORD_SECONDS + 10), lang: "en-IN" }, d)).status).toBe("bad_audio");
    const eightBit = encodeWav(new Float32Array(16_000)); eightBit[34] = 8;
    expect((await transcribeVoice({ audio: bytesToBase64(eightBit), lang: "en-IN" }, d)).status).toBe("bad_audio");
    expect(d.transcribe).not.toHaveBeenCalled();
  });
  it("a recording that is only a blip is 'empty' (nothing heard), not sent", async () => {
    const d = deps();
    expect((await transcribeVoice({ audio: wav(0.1), lang: "en-IN" }, d)).status).toBe("empty");
    expect(d.transcribe).not.toHaveBeenCalled();
  });
  it("respects the daily limit", async () => {
    const d = deps({ allow: vi.fn(async () => false) });
    expect((await transcribeVoice({ audio: wav(2), lang: "en-IN" }, d)).status).toBe("limit");
    expect(d.transcribe).not.toHaveBeenCalled();
  });
  it("maps every kind of failure to its own status", async () => {
    const run = (err: unknown) => transcribeVoice({ audio: wav(2), lang: "en-IN" }, deps({ transcribe: vi.fn(async () => { throw err; }) }));
    expect((await run(new AiNotConfiguredError("GEMINI_API_KEY"))).status).toBe("off");
    expect((await run(new AiRequestError("busy", 429))).status).toBe("busy");
    expect((await run(new AiRequestError("down", 503))).status).toBe("busy");
    expect((await run(new AiRequestError("bad", 500))).status).toBe("failed");
    expect((await run(new Error("boom"))).status).toBe("failed");
  });
  it("silence comes back as 'empty', and odd characters are cleaned from the words", async () => {
    expect((await transcribeVoice({ audio: wav(2), lang: "en-IN" }, deps({ transcribe: vi.fn(async () => "   ") }))).status).toBe("empty");
    const r = await transcribeVoice({ audio: wav(2), lang: "hi-IN" }, deps({ transcribe: vi.fn(async () => "goa\u0000 chalo\u0007  \n") }));
    expect(r.text).toBe("goa chalo");
  });
  it("the request is checked: only known languages, and a recording of real size", () => {
    expect(intakeVoiceSchema.safeParse({ audio: wav(2), lang: "te-IN" }).success).toBe(true);
    expect(intakeVoiceSchema.safeParse({ audio: wav(2), lang: "fr-FR" }).success).toBe(false);
    expect(intakeVoiceSchema.safeParse({ audio: "abc", lang: "en-IN" }).success).toBe(false);
    expect(intakeVoiceSchema.safeParse({ audio: "A".repeat(MAX_AUDIO_BASE64_CHARS + 1), lang: "en-IN" }).success).toBe(false);
  });
});

describe("Gemini transcription", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const ok = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }) as unknown as Response;
  const bad400 = (m: string) => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: m } }) }) as unknown as Response;
  it("sends the WAV as audio with a transcribe-only instruction in the right language", () => {
    const b = buildTranscribeRequest({ wavBase64: "QUJD", languageName: "Telugu", thinking: "budget0" });
    expect(b.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "audio/wav", data: "QUJD" } });
    expect((b.contents[0].parts[0] as { text: string }).text).toMatch(/Telugu[\s\S]*ONLY the words spoken/);
    expect(b.generationConfig).toMatchObject({ temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
  });
  it("reads the words out of the answer", () => {
    expect(textOf({ candidates: [{ content: { parts: [{ text: " hello " }, { text: "world" }] } }] })).toBe("hello world");
    expect(textOf({})).toBe("");
  });
  it("asks the model not to think, and tries the next way when it refuses", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaTestKey1234567890"); vi.stubEnv("GEMINI_MODEL", "gemini-flash-test-voice");
    const f = vi.fn().mockResolvedValueOnce(bad400("Budget 0 is invalid: this model only works in thinking mode.")).mockResolvedValue(ok("go to goa"));
    vi.stubGlobal("fetch", f);
    expect(await transcribeGemini({ wavBase64: "QUJD", languageName: "English" })).toBe("go to goa");
    expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-goog-api-key": "AIzaTestKey1234567890" });
    expect(String(f.mock.calls[0][0])).not.toContain("AIzaTestKey");
  });
  it("without a key it says so", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(transcribeGemini({ wavBase64: "QUJD", languageName: "English" })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});

describe("what the traveller is told", () => {
  it("every microphone problem and every server answer has its own plain sentence", () => {
    const mic = ["NotAllowedError", "NotFoundError", "NotReadableError"].map(micErrorMessage);
    expect(new Set(mic).size).toBe(3); expect(micErrorMessage("WeirdError")).toContain("WeirdError");
    const st = ["empty", "off", "limit", "busy", "bad_audio", "failed"].map(transcribeMessage);
    expect(new Set(st).size).toBe(6); expect(transcribeMessage("ok")).toBeNull();
    for (const m of [...mic, ...st]) expect(m).toMatch(/type|try again/i);
  });
});
