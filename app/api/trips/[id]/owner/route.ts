import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { transferOwnership } from "@/lib/server/trip-members";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/schemas";

const bodySchema = z.object({ user_id: uuid });

/** The owner hands the trip to another member. The old owner stays on the trip as a member (and may then leave). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const parsed = await parseBody(req, bodySchema);
  if (parsed.error) return parsed.error;

  const result = await transferOwnership({ supabase, tripId: id, newOwnerId: parsed.data.user_id });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
