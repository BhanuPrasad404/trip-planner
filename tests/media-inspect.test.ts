import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectVideo, sniffImage } from "@/lib/server/media-inspect";

const DIR = join(__dirname, "fixtures", "video");
const load = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

// Real files made with ffmpeg, in every shape phones and browsers produce. The expected lengths are what ffmpeg was told to record.
const CASES: [string, "mp4" | "webm", number][] = [
  ["classic-faststart-7s.mp4", "mp4", 7],
  ["classic-moov-end-12s.mp4", "mp4", 12],
  ["fragmented-17s.mp4", "mp4", 17],
  ["webm-with-duration-9s.webm", "webm", 9],
  ["webm-live-no-duration-23s.webm", "webm", 23],
  ["exactly-30s-fragmented.mp4", "mp4", 30],
  ["too-long-45s.mp4", "mp4", 45],
  ["too-long-fragmented-45s.mp4", "mp4", 45],
];

describe("measuring real videos from their bytes", () => {
  for (const [file, container, seconds] of CASES) {
    it(`${file} is ${seconds} s`, () => {
      const info = inspectVideo(load(file));
      expect(info).not.toBeNull();
      expect(info!.container).toBe(container);
      expect(info!.durationS).toBeGreaterThan(seconds - 0.3);
      expect(info!.durationS).toBeLessThan(seconds + 0.3);
    });
  }

  it("knows HOW it measured: a recording with no stored length is measured from its frames", () => {
    expect(inspectVideo(load("webm-live-no-duration-23s.webm"))!.method).toBe("frames");
    expect(["fragments", "mehd", "mdhd", "stts"]).toContain(inspectVideo(load("fragmented-17s.mp4"))!.method);
  });

  it("the fixtures really are the awkward kind (so the tests mean something)", () => {
    // Fragmented MP4: the movie header says the video is 0 long. A check that read that number would let anything through.
    const frag = load("fragmented-17s.mp4");
    const i = Buffer.from(frag).indexOf("mvhd");
    expect(i).toBeGreaterThan(0);
    expect([frag[i + 20], frag[i + 21], frag[i + 22], frag[i + 23]]).toEqual([0, 0, 0, 0]);
    // Chrome-style live WebM: the segment size is "unknown" (all ones) and there is no Duration inside the Info element.
    const live = load("webm-live-no-duration-23s.webm");
    expect(inspectVideo(live)!.method).toBe("frames");
  });
});

describe("a header that lies does not hide a long video", () => {
  it("zeroing or shrinking the movie-header length of a 45 s file still measures about 45 s", () => {
    const f = load("too-long-45s.mp4");
    const i = Buffer.from(f).indexOf("mvhd");
    expect(i).toBeGreaterThan(0);
    const tampered = new Uint8Array(f);
    // mvhd v0 payload: version/flags (4), created (4), modified (4), timescale (4), duration (4) → duration at i+4+16
    for (let k = 0; k < 4; k++) tampered[i + 4 + 16 + k] = 0;
    tampered[i + 4 + 16 + 3] = 5;                         // claim "5 ticks"
    const info = inspectVideo(tampered)!;
    expect(info.durationS).toBeGreaterThan(44);
  });
});

describe("garbage and truncation never crash and never pass as measurable", () => {
  it("returns null for non-video, empty and random bytes", () => {
    expect(inspectVideo(new Uint8Array())).toBeNull();
    expect(inspectVideo(new Uint8Array(5000).fill(7))).toBeNull();
    expect(inspectVideo(new TextEncoder().encode("<html>not a video</html>"))).toBeNull();
    const rnd = new Uint8Array(20_000); for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 2654435761) >>> 24;
    expect(inspectVideo(rnd)).toBeNull();
  });
  it("a file with a video header but nothing inside cannot claim a length", () => {
    expect(inspectVideo(new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]))).toBeNull();
    expect(inspectVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).toBeNull();
  });
  it("a cut-off recording still reports what is there (a lower bound), never throws", () => {
    for (const f of ["webm-live-no-duration-23s.webm", "fragmented-17s.mp4"]) {
      const full = load(f); const half = full.slice(0, Math.floor(full.length / 2));
      const info = inspectVideo(half);
      if (info) { expect(info.durationS).toBeGreaterThan(1); expect(info.durationS).toBeLessThanOrEqual(inspectVideo(full)!.durationS + 0.3); }
    }
  });
  it("every corrupted prefix of a real file is handled without throwing or hanging", () => {
    const f = load("fragmented-17s.mp4");
    for (let cut = 0; cut < 600; cut += 7) expect(() => inspectVideo(f.slice(0, cut))).not.toThrow();
    const bad = new Uint8Array(f); for (let i = 0; i < 400; i += 3) bad[i] ^= 0xff;
    expect(() => inspectVideo(bad)).not.toThrow();
  });
});

describe("image sniffing: a file's first bytes decide what it is", () => {
  it("recognises the formats we accept and nothing else", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(load("classic-faststart-7s.mp4").slice(0, 32))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
  it("lists the fixtures so a missing file fails loudly", () => {
    expect(readdirSync(DIR).length).toBeGreaterThanOrEqual(8);
  });
});
