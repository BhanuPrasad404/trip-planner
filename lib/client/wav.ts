// Speech-to-text services accept WAV everywhere, but a phone's recorder gives WebM or MP4. So a recording is decoded and written again as
// plain WAV: 16 kHz, one channel, 16-bit. Small enough to send (about 32 KB a second) and the format every provider understands.
export const WAV_RATE = 16_000;
/** Longest recording we keep, in seconds (the server refuses more). */
export const MAX_RECORD_SECONDS = 45;

/** Float samples (-1..1) → a WAV file's bytes. Pure. */
export function encodeWav(samples: Float32Array, sampleRate = WAV_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What a WAV's header says (for the server's checks, and tests). null when it isn't a plain PCM WAV. */
export function readWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; bits: number; dataBytes: number; seconds: number } | null {
  if (bytes.length < 44) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" || v.getUint16(20, true) !== 1) return null;
  const channels = v.getUint16(22, true), sampleRate = v.getUint32(24, true), bits = v.getUint16(34, true), dataBytes = v.getUint32(40, true);
  if (!channels || !sampleRate || !bits) return null;
  return { sampleRate, channels, bits, dataBytes, seconds: dataBytes / (sampleRate * channels * (bits / 8)) };
}

/** Browser only: any recording (WebM, MP4, OGG…) → 16 kHz mono WAV bytes. */
export async function blobToWav(blob: Blob): Promise<Uint8Array> {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.min(decoded.duration, MAX_RECORD_SECONDS);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * WAV_RATE)), WAV_RATE);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), WAV_RATE);
  } finally { void ctx.close(); }
}
