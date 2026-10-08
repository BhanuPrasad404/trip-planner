// Phone videos often carry the exact GPS position they were filmed at (MP4/MOV "©xyz" and 3GPP "loci" atoms).
// We promised not to publish exact locations, so before upload we zero those atoms' contents in place (sizes unchanged, so
// the file still plays). Photos need no scrub here: they are re-drawn on a canvas, which drops all metadata.

const TAGS: number[][] = [
  [0xa9, 0x78, 0x79, 0x7a], // ©xyz  (Apple / Android location)
  [0x6c, 0x6f, 0x63, 0x69], // loci  (3GPP location)
  [0x78, 0x79, 0x7a, 0x20], // "xyz " (some muxers)
];

/** Zeroes location atoms in an MP4/MOV buffer. Returns how many were cleared. Mutates `bytes`. */
export function scrubMp4Location(bytes: Uint8Array): number {
  let cleared = 0;
  for (let i = 4; i < bytes.length - 4; i++) {
    for (const tag of TAGS) {
      if (bytes[i] !== tag[0] || bytes[i + 1] !== tag[1] || bytes[i + 2] !== tag[2] || bytes[i + 3] !== tag[3]) continue;
      const size = ((bytes[i - 4] << 24) | (bytes[i - 3] << 16) | (bytes[i - 2] << 8) | bytes[i - 1]) >>> 0;
      // A real location atom is tiny; a coincidental byte pattern inside video data will not have a plausible size in front of it.
      if (size < 12 || size > 4096 || i - 4 + size > bytes.length) continue;
      bytes.fill(0, i + 4, i - 4 + size);
      cleared++;
    }
  }
  return cleared;
}
