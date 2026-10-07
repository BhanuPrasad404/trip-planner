// Runs queued tile ingestions a few at a time, never throwing. Called after a response is sent.
import { getPoiService } from "./index";
import type { IngestTask } from "./service";

export const MAX_BACKGROUND_TILES = 12; // most tiles one request may queue

export async function runBackground(tasks: IngestTask[], concurrency = 3): Promise<void> {
  const svc = getPoiService();
  const queue = tasks.slice(0, MAX_BACKGROUND_TILES);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        await svc.ingest(t).catch((e) => console.error("[poi] background tile failed:", e instanceof Error ? e.message : e));
      }
    })
  );
}
