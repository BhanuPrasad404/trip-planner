import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { buildAccountExport, exportFileName } from "@/lib/server/account";
import { createClient } from "@/lib/supabase/server";

/** Download everything Trailmate holds about the signed-in person, as one JSON file. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`account-export:${user.id}`, 3, 3_600_000)) return jsonError("You can download your data 3 times an hour. Please try again later.", 429);
  const data = await buildAccountExport(supabase, user);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${exportFileName()}"`, "cache-control": "no-store" },
  });
}
