import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { groupSubmitSchema } from "@/lib/intake/group";
import { guestLookup, guestOwnAnswer, guestSubmit } from "@/lib/intake/group-store";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { rateLimiter } from "@/lib/rate-limit";

const CODE = /^[a-f0-9]{16}$/;
type Ctx = { params: Promise<{ code: string }> };

// A friend's side of "Ask your group" — no sign-up needed. They see only the trip's name, type their name and answer 3 things.
// Guests are identified by a random cookie (hashed before it reaches the database) so they can change their own answer on the same
// phone; their answer is saved through a database function only our server may call (lib/intake/group-store.ts). Signed-in people
// answer as themselves. Answering never makes anyone a member of the trip and never shows the trip's places or other people's names.

/** The trip's name, whether the link takes answers, and your own answer if you gave one. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const visitor = await identify(req);
  if (!rateLimiter.take(`poll-read:${burstKey(visitor)}`, PER_MINUTE.poll * 3, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  if (!CODE.test(code)) return rememberVisitor(NextResponse.json({ status: "invalid" }), visitor);
  let info: unknown, mine: unknown;
  if (visitor.kind === "user") {
    const r = await visitor.supabase.rpc("poll_lookup", { p_code: code });
    if (r.error) return rememberVisitor(jsonError("Couldn't open this link right now. Please try again.", 503), visitor);
    info = r.data;
    mine = (await visitor.supabase.rpc("my_group_answer", { p_code: code })).data;
  } else {
    const r = await guestLookup(code);
    if (!r) return rememberVisitor(jsonError("Couldn't open this link right now. Please try again.", 503), visitor);
    info = r.info;
    mine = await guestOwnAnswer(code, visitor.key);
  }
  return rememberVisitor(NextResponse.json({ ...(info as object), mine: mine ?? null, signedIn: visitor.kind === "user" }, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}

/** Save or change your answer. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { code } = await params;
  const visitor = await identify(req);
  if (!rateLimiter.take(`poll:${burstKey(visitor)}`, PER_MINUTE.poll, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  if (!CODE.test(code)) return rememberVisitor(jsonError("This link isn't valid.", 404), visitor);
  const { data: input, error } = await parseBody(req, groupSubmitSchema);
  if (error) return rememberVisitor(error, visitor);
  if (!(await allowCall(visitor, "poll"))) return rememberVisitor(jsonError("You've changed your answer many times today. Please try again tomorrow.", 429), visitor);

  const result = visitor.kind === "user"
    ? await visitor.supabase.rpc("submit_group_answer", { p_code: code, p_name: input.name, p_answers: input.answers })
    : await guestSubmit(code, visitor.key, input.name, input.answers);
  if (!result || result.error) return rememberVisitor(jsonError("Couldn't save your answer right now. Please try again.", 503), visitor);

  const status = (result.data as { status?: string } | null)?.status;
  const message: Record<string, [number, string]> = {
    invalid: [404, "This link isn't valid any more. Ask for a new one."],
    closed: [409, "The trip owner has stopped taking answers on this link."],
    full: [409, "This trip already has 30 answers, the most it takes."],
    bad_name: [400, "Write your name (up to 40 letters)."],
    bad_answers: [400, "Those answers couldn't be read. Please try again."],
  };
  if (status && message[status]) return rememberVisitor(jsonError(message[status][1], message[status][0]), visitor);
  return rememberVisitor(NextResponse.json({ status: status ?? "saved" }), visitor);
}
