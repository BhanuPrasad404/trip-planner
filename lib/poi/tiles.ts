// Map tiles are our unit of "have we already fetched this part of the world?".
// Zoom 10 ≈ 38 km squares at India's latitudes: small enough for fast ingestion, big enough to need few of them.
import { distanceKm } from "@/lib/geo";
import type { BBox } from "@/lib/providers/types";
import type { LngLat } from "./types";

export const TILE_ZOOM = 10;

export type Tile = { z: number; x: number; y: number; key: string };
const key = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

export function tileOf(lat: number, lng: number, z = TILE_ZOOM): Tile {
  const n = 2 ** z;
  const clampLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const latRad = (clampLat * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)));
  return { z, x, y, key: key(z, x, y) };
}

export function tileBBox(t: { z: number; x: number; y: number }): BBox {
  const n = 2 ** t.z;
  const lng = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { west: lng(t.x), east: lng(t.x + 1), north: lat(t.y), south: lat(t.y + 1) };
}

export function parseTileKey(k: string): Tile | null {
  const m = /^(\d{1,2})\/(\d+)\/(\d+)$/.exec(k);
  return m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), key: k } : null;
}

/**
 * Tiles touched by a buffered corridor around a polyline, in the order the route reaches them.
 * (Samples the line every ~3 km and adds every tile the buffered sample can reach.)
 */
export function tilesAlongLine(line: LngLat[], bufferKm: number, z = TILE_ZOOM): Tile[] {
  const out = new Map<string, Tile>();
  const add = (lat: number, lng: number) => {
    const dLat = bufferKm / 111;
    const dLng = bufferKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const a = tileOf(lat + dLat, lng - dLng, z);
    const b = tileOf(lat - dLat, lng + dLng, z);
    const batch: { t: Tile; d: number }[] = [];
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) {
        const k = key(z, x, y);
        if (out.has(k)) continue;
        const box = tileBBox({ z, x, y });
        batch.push({ t: { z, x, y, key: k }, d: distanceKm({ lat, lng }, { lat: (box.north + box.south) / 2, lng: (box.east + box.west) / 2 }) });
      }
    }
    for (const { t } of batch.sort((p, q) => p.d - q.d)) out.set(t.key, t); // nearest tile first
  };
  let carry = 0;
  for (let i = 0; i < line.length; i++) {
    const [lng, lat] = line[i];
    if (i === 0) { add(lat, lng); continue; }
    const [pl, pa] = line[i - 1];
    const seg = distanceKm({ lat: pa, lng: pl }, { lat, lng });
    const steps = Math.max(1, Math.ceil((seg + carry) / 3));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      add(pa + (lat - pa) * f, pl + (lng - pl) * f);
    }
    carry = 0;
  }
  return [...out.values()];
}

/** Every tile that touches a bounding box (for pre-loading a whole region). */
export function tilesInBBox(box: BBox, z = TILE_ZOOM): Tile[] {
  const a = tileOf(box.north, box.west, z);
  const b = tileOf(box.south, box.east, z);
  const out: Tile[] = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y, key: key(z, x, y) });
  return out;
}
