// Builds app/favicon.ico and app/icon.svg from the Trailmate mark (the amber sun, green hills and dotted trail), replacing the default
// Next.js / Vercel icon. Run: node scripts/make-favicon.mjs   (needs `sharp`, which Next.js already installs)
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const MARK = `<circle cx="13" cy="13" r="13" fill="#E8A33D"/><path d="M5 18.5l4.6-6.2 2.6 3.2 3-5.4 5.8 8.4z" fill="#0B3D3A"/><path d="M6 20.5c3-1.2 6-.3 9-1.4 2-.7 3.6-.6 5-1.1" stroke="#0B3D3A" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="0.1 2.4" fill="none"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26">${MARK}</svg>`;
writeFileSync("app/icon.svg", svg);

// An .ico is a small header plus one PNG per size: 16 (tabs), 32 (taskbars), 48 (shortcuts).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(svg), { density: 384 }).resize(s, s).png().toBuffer()));
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = Buffer.concat(sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length;
  return e;
}));
writeFileSync("app/favicon.ico", Buffer.concat([head, dir, ...pngs]));
console.log("wrote app/icon.svg and app/favicon.ico", pngs.map((p) => p.length));
