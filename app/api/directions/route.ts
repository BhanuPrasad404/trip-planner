import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { distanceKm } from "@/lib/geo";
import { describeRoutes, estimateDirections } from "@/lib/map/directions";
import { routingProvider } from "@/lib/providers/registry";
import { consumeQuota } from "@/lib/quota";
import { directionsSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;
const MAX_STRAIGHT_KM = 2_500; // one navigation leg, not a continent

// Turn-by-turn directions "here → next stop" with alternative routes. Positions are used for this request only and are not stored.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, directionsSchema);
  if (bodyError) return bodyError;
  if (distanceKm(input.from, input.to) > MAX_STRAIGHT_KM) return jsonError("That destination is too far for one navigation leg.", 400);

  if (!(await consumeQuota(supabase, "directions", 300))) return jsonError("Too many route requests today. Please try again tomorrow.", 429);

  const provider = routingProvider();
  const routes = provider.directions ? await provider.directions(input.from, input.to, { alternatives: input.alternatives }) : [estimateDirections(input.from, input.to)];
  const real = routes.some((r) => r.source === "osrm");
  return NextResponse.json({
    routes,
    choices: describeRoutes(routes),
    // Plain statement of what we do NOT know: no live traffic is applied to these times.
    notes: [
      ...(real ? ["Times use typical road speeds. Live traffic isn't connected."] : ["Road directions are unavailable right now, so this is a straight-line estimate without turn-by-turn."]),
    ],
  });
}
