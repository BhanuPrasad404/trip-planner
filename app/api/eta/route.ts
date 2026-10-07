import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { getRoute } from "@/lib/eta";
import { consumeQuota } from "@/lib/quota";
import { etaSchema } from "@/lib/validation/schemas";

export const maxDuration = 15;

// Road route + legs from the first point (you) through the following points (next stops).
// Positions are used for this request only and are never stored by this route.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, etaSchema);
  if (bodyError) return bodyError;

  if (!(await consumeQuota(supabase, "eta", 1500))) return jsonError("Too many route updates today. Please try again tomorrow.", 429);

  const route = await getRoute(input.points);
  return NextResponse.json(route);
}
