import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { REPORT_PHOTO_BUCKET } from "@/lib/reports";
import { uuid } from "@/lib/validation/schemas";

// Delete your own report (and its photo). RLS only lets you delete rows you wrote.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid report id", 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data, error } = await supabase.from("place_reports").delete().eq("id", id).select("id, photo_path");
  if (error) return dbError(error, "report: delete");
  if (!data || data.length === 0) return jsonError("Report not found", 404);

  const photo = data[0].photo_path as string | null;
  if (photo) {
    const { error: rmError } = await supabase.storage.from(REPORT_PHOTO_BUCKET).remove([photo]);
    if (rmError) console.error("[api] report: photo cleanup failed:", rmError.message); // the report is gone either way
  }
  return NextResponse.json({ ok: true });
}
