// Measures how long a video REALLY is, from the bytes — never from anything the client claims.
//
// Why this is more than reading one number:
//  * A normal MP4 stores its length in the header, but a hostile file can lie there, so we also add up the real sample tables.
//  * Browsers record "fragmented" MP4 (Safari/Chrome mp4) with a header length of ZERO; the length only exists as the sum of its fragments.
//  * Chrome records WebM live, with NO stored length at all; the length is the timestamp of the last frame.
// The answer is the LARGEST length any honest method gives, so lowering one number in the header cannot hide a long video.
// Pure functions over bytes: no network, no filesystem, fully testable.

export type VideoInfo = { container: "mp4" | "webm"; durationS: number; method: string };

const MAX_BOXES = 200_000;   // a hostile file cannot make us loop forever

// ───────────────────────────── MP4 / MOV ─────────────────────────────
type Box = { type: string; start: number; payload: number; end: number };

const u32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : 0);
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4_294_967_296 + u32(b, o + 4);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let o = from;
  let n = 0;
  while (o + 8 <= to && n++ < MAX_BOXES) {
    let size = u32(b, o);
    let header = 8;
    if (size === 1) { size = u64(b, o + 8); header = 16; }
    else if (size === 0) size = to - o;                         // "extends to the end of the file"
    if (size < header || o + size > to) size = Math.min(Math.max(size, header), to - o);   // truncated file: use what is there
    yield { type: tag(b, o + 4), start: o, payload: o + header, end: o + size };
    if (size <= 0) return;
    o += size;
  }
}
const child = (b: Uint8Array, parent: Box, type: string): Box | null => { for (const c of boxes(b, parent.payload, parent.end)) if (c.type === type) return c; return null; };
const children = (b: Uint8Array, parent: Box, type: string): Box[] => { const out: Box[] = []; for (const c of boxes(b, parent.payload, parent.end)) if (c.type === type) out.push(c); return out; };

type Track = { id: number; timescale: number; headerDuration: number; tableTicks: number; defaultSampleDuration: number };

function readMdhd(b: Uint8Array, box: Box): { timescale: number; duration: number } {
  const v = b[box.payload];
  return v === 1 ? { timescale: u32(b, box.payload + 20), duration: u64(b, box.payload + 24) } : { timescale: u32(b, box.payload + 12), duration: u32(b, box.payload + 16) };
}

function sttsTicks(b: Uint8Array, stts: Box): number {
  const count = u32(b, stts.payload + 4);
  let ticks = 0;
  for (let i = 0, o = stts.payload + 8; i < count && o + 8 <= stts.end && i < MAX_BOXES; i++, o += 8) ticks += u32(b, o) * u32(b, o + 4);
  return ticks;
}

function inspectMp4(b: Uint8Array): VideoInfo | null {
  const top = [...boxes(b, 0, b.length)];
  const moov = top.find((x) => x.type === "moov");
  if (!moov) return null;

  const tracks = new Map<number, Track>();
  for (const trak of children(b, moov, "trak")) {
    const tkhd = child(b, trak, "tkhd");
    const mdia = child(b, trak, "mdia");
    const mdhd = mdia && child(b, mdia, "mdhd");
    if (!tkhd || !mdhd) continue;
    const id = b[tkhd.payload] === 1 ? u32(b, tkhd.payload + 20) : u32(b, tkhd.payload + 12);
    const { timescale, duration } = readMdhd(b, mdhd);
    const stts = mdia && (() => { const minf = child(b, mdia, "minf"); const stbl = minf && child(b, minf, "stbl"); return stbl && child(b, stbl, "stts"); })();
    if (timescale > 0) tracks.set(id, { id, timescale, headerDuration: duration, tableTicks: stts ? sttsTicks(b, stts) : 0, defaultSampleDuration: 0 });
  }

  const seconds: { s: number; how: string }[] = [];

  // Method 1: the movie header's own number.
  const mvhd = child(b, moov, "mvhd");
  let movieScale = 0;
  if (mvhd) {
    const v2 = b[mvhd.payload] === 1;
    movieScale = u32(b, mvhd.payload + (v2 ? 20 : 12));
    const d = v2 ? u64(b, mvhd.payload + 24) : u32(b, mvhd.payload + 16);
    if (movieScale > 0 && d > 0 && d < 2 ** 52) seconds.push({ s: d / movieScale, how: "mvhd" });
  }
  // Method 2: each track's header length and its REAL sample table (the one a player actually follows).
  for (const t of tracks.values()) {
    if (t.headerDuration > 0) seconds.push({ s: t.headerDuration / t.timescale, how: "mdhd" });
    if (t.tableTicks > 0) seconds.push({ s: t.tableTicks / t.timescale, how: "stts" });
  }

  // Method 3: fragmented files — "movie extends" header, then the sum of every fragment's samples.
  const mvex = child(b, moov, "mvex");
  if (mvex) {
    const mehd = child(b, mvex, "mehd");
    if (mehd && movieScale > 0) {
      const d = b[mehd.payload] === 1 ? u64(b, mehd.payload + 4) : u32(b, mehd.payload + 4);
      if (d > 0 && d < 2 ** 52) seconds.push({ s: d / movieScale, how: "mehd" });
    }
    for (const trex of children(b, mvex, "trex")) { const t = tracks.get(u32(b, trex.payload + 4)); if (t) t.defaultSampleDuration = u32(b, trex.payload + 12); }
  }
  const fragTicks = new Map<number, number>();
  for (const moof of top.filter((x) => x.type === "moof")) {
    for (const traf of children(b, moof, "traf")) {
      const tfhd = child(b, traf, "tfhd");
      if (!tfhd) continue;
      const flags = u32(b, tfhd.payload) & 0xffffff;
      const id = u32(b, tfhd.payload + 4);
      let o = tfhd.payload + 8;
      if (flags & 0x1) o += 8;
      if (flags & 0x2) o += 4;
      const tfhdDefault = flags & 0x8 ? u32(b, o) : 0;
      const def = tfhdDefault || tracks.get(id)?.defaultSampleDuration || 0;
      for (const trun of children(b, traf, "trun")) {
        const tf = u32(b, trun.payload) & 0xffffff;
        const count = u32(b, trun.payload + 4);
        let p = trun.payload + 8;
        if (tf & 0x1) p += 4;
        if (tf & 0x4) p += 4;
        const per = (tf & 0x100 ? 4 : 0) + (tf & 0x200 ? 4 : 0) + (tf & 0x400 ? 4 : 0) + (tf & 0x800 ? 4 : 0);
        let ticks = 0;
        if (tf & 0x100) {
          for (let i = 0; i < count && p + per <= trun.end && i < MAX_BOXES; i++, p += per) ticks += u32(b, p);
        } else ticks = count * def;
        fragTicks.set(id, (fragTicks.get(id) ?? 0) + ticks);
      }
    }
  }
  for (const [id, ticks] of fragTicks) { const t = tracks.get(id); if (t && ticks > 0) seconds.push({ s: ticks / t.timescale, how: "fragments" }); }

  if (seconds.length === 0) return null;
  const best = seconds.reduce((a, c) => (c.s > a.s ? c : a));
  return { container: "mp4", durationS: best.s, method: best.how };
}

// ───────────────────────────── WebM / Matroska ─────────────────────────────
const ID = { segment: 0x18538067, info: 0x1549a966, cluster: 0x1f43b675, timecode: 0xe7, simpleBlock: 0xa3, blockGroup: 0xa0, block: 0xa1, blockDuration: 0x9b, scale: 0x2ad7b1, duration: 0x4489 };
const TOP_LEVEL = new Set([0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0x1941a469, 0x114d9b74, 0x1549a966, 0x1654ae6b]);

type El = { id: number; dataStart: number; dataEnd: number; unknown: boolean; next: number };
function readEl(b: Uint8Array, o: number, limit: number): El | null {
  if (o >= limit) return null;
  const first = b[o];
  let idLen = 1; while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4 || o + idLen >= limit) return null;
  let id = 0; for (let i = 0; i < idLen; i++) id = id * 256 + b[o + i];
  const s0 = b[o + idLen];
  let sLen = 1; while (sLen <= 8 && !(s0 & (0x80 >> (sLen - 1)))) sLen++;
  if (sLen > 8 || o + idLen + sLen > limit) return null;
  let size = s0 & (0xff >> sLen); let allOnes = size === (0xff >> sLen);
  for (let i = 1; i < sLen; i++) { const v = b[o + idLen + i]; size = size * 256 + v; if (v !== 0xff) allOnes = false; }
  const dataStart = o + idLen + sLen;
  const unknown = allOnes;
  const dataEnd = unknown ? limit : Math.min(dataStart + size, limit);
  return { id, dataStart, dataEnd, unknown, next: dataEnd };
}
const uint = (b: Uint8Array, s: number, e: number) => { let v = 0; for (let i = s; i < e && i < s + 8; i++) v = v * 256 + b[i]; return v; };
const float = (b: Uint8Array, s: number, e: number) => { const dv = new DataView(b.buffer, b.byteOffset + s, e - s); return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : 0; };

function inspectWebm(b: Uint8Array): VideoInfo | null {
  let scale = 1_000_000;                    // nanoseconds per tick (the format's default: 1 ms)
  let header = 0;                           // the stored duration, if any
  let lastMs = 0;                           // timestamp of the latest frame, in ticks
  let n = 0;

  const walkCluster = (start: number, end: number, unknownSize: boolean): number => {
    let base = 0; let o = start;
    while (o < end && n++ < MAX_BOXES) {
      const el = readEl(b, o, end);
      if (!el) break;
      if (unknownSize && TOP_LEVEL.has(el.id)) return o;                // the next cluster/cues begins: this cluster is over
      if (el.id === ID.timecode) base = uint(b, el.dataStart, el.dataEnd);
      else if (el.id === ID.simpleBlock || el.id === ID.block) {
        let p = el.dataStart; const t0 = b[p]; let l = 1; while (l <= 8 && !(t0 & (0x80 >> (l - 1)))) l++;
        p += l;
        if (p + 2 <= el.dataEnd) { const rel = (b[p] << 8) | b[p + 1]; lastMs = Math.max(lastMs, base + (rel > 0x7fff ? rel - 0x10000 : rel)); }
      } else if (el.id === ID.blockGroup) {
        let q = el.dataStart; let dur = 0; let at = 0;
        while (q < el.dataEnd && n++ < MAX_BOXES) {
          const g = readEl(b, q, el.dataEnd); if (!g) break;
          if (g.id === ID.block) { let p = g.dataStart; const t0 = b[p]; let l = 1; while (l <= 8 && !(t0 & (0x80 >> (l - 1)))) l++; p += l; if (p + 2 <= g.dataEnd) at = base + (((b[p] << 8) | b[p + 1]) << 16 >> 16); }
          else if (g.id === ID.blockDuration) dur = uint(b, g.dataStart, g.dataEnd);
          q = g.next;
        }
        lastMs = Math.max(lastMs, at + dur);
      }
      o = el.next;
    }
    return end;
  };

  const walkSegment = (start: number, end: number) => {
    let o = start;
    while (o < end && n++ < MAX_BOXES) {
      const el = readEl(b, o, end);
      if (!el) break;
      if (el.id === ID.info) {
        let q = el.dataStart;
        while (q < el.dataEnd && n++ < MAX_BOXES) {
          const g = readEl(b, q, el.dataEnd); if (!g) break;
          if (g.id === ID.scale) scale = uint(b, g.dataStart, g.dataEnd) || scale;
          else if (g.id === ID.duration) header = float(b, g.dataStart, g.dataEnd);
          q = g.next;
        }
      } else if (el.id === ID.cluster) {
        o = el.unknown ? walkCluster(el.dataStart, end, true) : (walkCluster(el.dataStart, el.dataEnd, false), el.next);
        continue;
      }
      o = el.next;
    }
  };

  let o = 0;
  while (o < b.length && n++ < MAX_BOXES) {
    const el = readEl(b, o, b.length);
    if (!el) break;
    if (el.id === ID.segment) { walkSegment(el.dataStart, el.dataEnd); break; }
    o = el.next;
  }
  const fromHeader = header > 0 ? (header * scale) / 1e9 : 0;
  // One frame's length is added to the last timestamp (a frame lasts until the next one would start).
  const fromFrames = lastMs > 0 ? (lastMs * scale) / 1e9 : 0;
  const best = Math.max(fromHeader, fromFrames);
  return best > 0 && Number.isFinite(best) ? { container: "webm", durationS: best, method: fromFrames >= fromHeader ? "frames" : "header" } : null;
}

/** null = not a video we can measure (so the caller must refuse it: unknowable length is not allowed through). */
export function inspectVideo(bytes: Uint8Array): VideoInfo | null {
  try {
    if (bytes.length >= 12 && tag(bytes, 4) === "ftyp") return inspectMp4(bytes);
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return inspectWebm(bytes);
  } catch { /* a malformed file is simply unmeasurable */ }
  return null;
}

/** What a picture's first bytes say it is — so a renamed file cannot pass as a photo. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP") return "image/webp";
  return null;
}
