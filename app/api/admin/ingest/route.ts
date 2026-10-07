import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { getPoiService } from "@/lib/poi";
import { tilesInBBox } from "@/lib/poi/tiles";
import type { PoiGroup } from "@/lib/providers/types";

export const maxDuration = 300;

const bodySchema = z.object({
  south: z.number().min(-85).max(85),
  west: z.number().min(-180).max(180),
  north: z.number().min(-85).max(85),
  east: z.number().min(-180).max(180),
  groups: z.array(z.enum(["essentials", "stay", "sights", "parking"])).min(1).default(["essentials", "stay", "sights"]),
  /** Most tiles to ingest in ONE call; call again until `remaining` is 0. */
  max_tiles: z.number().int().min(1).max(40).default(10),
});

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Pre-load a whole region into our places database (e.g. all of Andhra Pradesh + Telangana) BEFORE anyone drives there.
// Protected by INGEST_SECRET; if it isn't configured this route does not exist. Run it with scripts/ingest-region.mjs.
export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || secret.length < 16) return new NextResponse(null, { status: 404 });
  if (!safeEqual(req.headers.get("x-ingest-secret") ?? "", secret)) return jsonError("Not allowed", 401);

  const { data: input, error: bodyError } = await parseBody(req, bodySchema);
  if (bodyError) return bodyError;
  if (input.north <= input.south || input.east <= input.west) return jsonError("The box is upside down: north must be above south, east right of west.", 400);
  if (input.north - input.south > 10 || input.east - input.west > 10) return jsonError("That box is too big. Use pieces of at most 10° × 10°.", 400);

  const svc = getPoiService();
  const tiles = tilesInBBox(input);
  const todo: { tile: (typeof tiles)[number]; group: PoiGroup }[] = [];
  for (const group of input.groups) {
    const status = await svc.store.tileStatus(tiles.map((t) => t.key), group);
    for (const tile of tiles) {
      const s = status.get(tile.key);
      if (!s || s.status === "failed") todo.push({ tile, group });
    }
  }

  const batch = todo.slice(0, input.max_tiles);
  let ingested = 0, failed = 0, places = 0;
  const queue = [...batch];
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try { places += await svc.ingest(t); ingested++; } catch (e) { failed++; console.error("[ingest]", t.tile.key, t.group, e instanceof Error ? e.message : e); }
    }
  }));

  return NextResponse.json({ tiles: tiles.length, groups: input.groups, ingested, failed, places, remaining: todo.length - batch.length, store: svc.store.id });
}
