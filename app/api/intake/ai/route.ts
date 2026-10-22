import { NextResponse, type NextRequest } from "next/server";
import { callTool } from "@/lib/ai/client";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { readWithAi } from "@/lib/intake/service";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { PER_MINUTE } from "@/lib/places/limits";
import { photonSearch } from "@/lib/places/photon";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { intakeReadSchema } from "@/lib/validation/schemas";

export const maxDuration = 30;

// The AI half of reading a trip description — signed in or not, limited per visitor. The AI only READS: every answer must quote the
// traveller's own words and is checked against them (lib/intake/ai-read.ts). We never wait more than 12 seconds: the screen already
// shows the instant reading, and says plainly when the AI didn't answer. Nothing is stored; the text goes to the AI provider only.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-ai:${burstKey(visitor)}`, PER_MINUTE.ai, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeReadSchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await readWithAi(input.text, input.start, {
    llm: callTool,
    allowAi: () => allowCall(visitor, "ai"),
    index: () => loadGeoIndex(),
    photon: (q, near) => photonSearch(q, near),
    allow: () => allowCall(visitor, "map"),
  });
  if (answer.status === "failed") console.error("[intake/ai] the AI request failed");
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
