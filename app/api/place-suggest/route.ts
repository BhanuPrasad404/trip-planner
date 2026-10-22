import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { PER_MINUTE } from "@/lib/places/limits";
import { suggestPlaces } from "@/lib/places/suggest";
import { burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { createClient } from "@/lib/supabase/server";
import { placeSuggestSchema } from "@/lib/validation/schemas";

// What the search box offers before anything is typed — signed in or not. Only our own data and the GeoNames index: no outside service
// is called, so nothing here counts against a daily limit.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`place-suggest:${burstKey(visitor)}`, PER_MINUTE.suggest, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, placeSuggestSchema);
  if (error) return rememberVisitor(error, visitor);

  const groups = await suggestPlaces(input.near, {
    index: () => loadGeoIndex(),
    // Posted-about destinations are readable only by signed-in travellers (row level security); guests simply don't get this group.
    shared: async () => {
      if (visitor.kind !== "user") return null;
      const { data, error: e } = await visitor.supabase.from("destinations").select("id, name, lat, lng, post_count").order("post_count", { ascending: false }).limit(300);
      if (e) return null;
      return (data ?? []).map((d) => ({ id: d.id as string, name: d.name as string, lat: d.lat as number, lng: d.lng as number, posts: (d.post_count as number) ?? 0 }));
    },
    researched: async () => {
      const supabase = visitor.kind === "user" ? visitor.supabase : await createClient();
      const { data, error: e } = await supabase.from("season_tags").select("id, place_name, lat, lng, category, region");
      if (e) return [];
      return (data ?? []).map((t) => ({ id: t.id as string, name: t.place_name as string, lat: t.lat as number, lng: t.lng as number, category: (t.category as string | null) ?? null, region: (t.region as string | null) ?? null }));
    },
  });
  return rememberVisitor(NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
