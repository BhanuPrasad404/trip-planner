import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { summarizeGroup } from "@/lib/intake/group";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };
const actionSchema = z.object({ action: z.enum(["open", "close", "new_link", "apply"]) });
const removeSchema = z.object({ answer_id: uuid });

async function who(id: string) {
  if (!uuid.safeParse(id).success) return { error: jsonError("Invalid trip id", 400) } as const;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: jsonError("Please sign in", 401) } as const;
  return { supabase, user } as const;
}

/** Members: the group's answers and where it agrees or splits. The owner also gets the link and whether it is open. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const w = await who(id);
  if ("error" in w) return w.error;
  const { data: trip, error: tripError } = await w.supabase.from("trips").select("id, owner_id, poll_code, poll_open").eq("id", id).maybeSingle();
  if (tripError) return jsonError("Couldn't load the trip.", 500);
  if (!trip) return jsonError("Trip not found", 404);
  const { data: rows, error } = await w.supabase.from("trip_group_answers").select("id, display_name, answers, updated_at, user_id").eq("trip_id", id).order("created_at");
  if (error) return jsonError("Couldn't load the group's answers.", 500);
  const owner = trip.owner_id === w.user.id;
  return NextResponse.json({
    owner,
    link: owner ? { code: trip.poll_code ?? null, open: !!trip.poll_open } : null,
    answers: (rows ?? []).map((r) => ({ id: r.id, name: r.display_name, answers: r.answers, updatedAt: r.updated_at, member: r.user_id !== null })),
    summary: summarizeGroup(rows ?? []),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Owner: share the link (open), stop taking answers (close), or make a new link (the old one stops working at once). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const w = await who(id);
  if ("error" in w) return w.error;
  const { data: input, error } = await parseBody(req, actionSchema);
  if (error) return error;
  if (input.action === "apply") return applyAgreements(w.supabase, w.user.id, id);
  const { data, error: rpcError } = await w.supabase.rpc("set_trip_poll", { p_trip: id, p_open: input.action !== "close", p_new_code: input.action === "new_link" });
  if (rpcError) return rpcError.code === "42501" ? jsonError("Only the trip owner can share or stop the group link.", 403) : jsonError("Couldn't change the group link right now.", 500);
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ code: row?.poll_code ?? null, open: !!row?.poll_open });
}

/**
 * Owner: make what the group AGREES on the trip's preferences (pace, interests, no night driving, things to avoid). Computed here from the
 * stored answers, never from what the phone sends; splits are left for the owner to decide. Other preferences are kept.
 */
async function applyAgreements(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data: trip, error: tripError } = await supabase.from("trips").select("id, owner_id, intake").eq("id", id).maybeSingle();
  if (tripError) return jsonError("Couldn't load the trip.", 500);
  if (!trip) return jsonError("Trip not found", 404);
  if (trip.owner_id !== userId) return jsonError("Only the trip owner can use the group's answers.", 403);
  const { data: rows, error } = await supabase.from("trip_group_answers").select("answers").eq("trip_id", id);
  if (error) return jsonError("Couldn't load the group's answers.", 500);
  const d = summarizeGroup(rows ?? []).defaults;
  const intake = {
    ...((trip.intake as Record<string, unknown> | null) ?? {}),
    ...(d.pace ? { pace: d.pace } : {}),
    ...(d.interests?.length ? { interests: d.interests } : {}),
    ...(d.nightDriving === false ? { night_driving: false } : {}),
    ...(d.avoid?.length ? { avoid: d.avoid } : {}),
  };
  const { error: upError } = await supabase.from("trips").update({ intake }).eq("id", id);
  if (upError) return jsonError("Couldn't save the group's choices.", 500);
  return NextResponse.json({ ok: true, intake, applied: d });
}

/** Owner: remove one answer. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const w = await who(id);
  if ("error" in w) return w.error;
  const { data: input, error } = await parseBody(req, removeSchema);
  if (error) return error;
  const { data, error: rpcError } = await w.supabase.rpc("remove_group_answer", { p_answer: input.answer_id });
  if (rpcError) return jsonError("Couldn't remove that answer right now.", 500);
  if (!data) return jsonError("Only the trip owner can remove an answer.", 403);
  return NextResponse.json({ ok: true });
}
