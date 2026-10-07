import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { uuid } from "@/lib/validation/schemas";

// Flag a report as wrong or inappropriate. Three different people flagging hides it for everyone else.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid report id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { error } = await supabase.from("report_flags").insert({ report_id: id, user_id: user.id });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true }); // you already flagged it
    return dbError(error, "report: flag");
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
