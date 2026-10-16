import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { INVITE_EXPIRY_HOURS, rotateInvite } from "@/lib/server/invites";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/schemas";

const bodySchema = z.object({
  expires_in_hours: z.union([z.null(), z.literal(INVITE_EXPIRY_HOURS[0]), z.literal(INVITE_EXPIRY_HOURS[1]), z.literal(INVITE_EXPIRY_HOURS[2])]),
});

/** Owner only: a new invite link (the old one stops working at once), never expiring or expiring after 1 / 7 / 30 days. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const parsed = await parseBody(req, bodySchema);
  if (parsed.error) return parsed.error;

  const result = await rotateInvite(supabase, id, parsed.data.expires_in_hours);
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true, invite_code: result.code, invite_expires_at: result.expiresAt });
}
