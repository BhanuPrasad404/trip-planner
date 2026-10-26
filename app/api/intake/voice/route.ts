import { NextResponse, type NextRequest } from "next/server";
import { transcribeGemini } from "@/lib/ai/transcribe";
import { jsonError, parseBody } from "@/lib/api";
import { aiProviderId } from "@/lib/config";
import { transcribeVoice, intakeVoiceSchema } from "@/lib/intake/voice-service";
import { rateLimiter } from "@/lib/rate-limit";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";

export const maxDuration = 30;

// Speech to text for browsers whose own recogniser fails. A short WAV in, plain words out; the words go into the trip text box, where the
// traveller reads and edits them before anything is read as a trip. Nothing is stored. Shares the AI allowance (it costs the same kind of call).
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-voice:${burstKey(visitor)}`, PER_MINUTE.ai, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeVoiceSchema);
  if (error) return rememberVisitor(error, visitor);
  const answer = await transcribeVoice(input, { transcribe: transcribeGemini, allow: () => allowCall(visitor, "ai"), available: aiProviderId() === "gemini", signal: req.signal });
  if (answer.status === "failed") console.error("[intake/voice] the transcription failed");
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
