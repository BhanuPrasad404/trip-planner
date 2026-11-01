import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { AREA_MATCH_KM, type Nearby } from "@/lib/engine/settlement";
import { nearestTo } from "@/lib/places/geo-index";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { DESTINATION_ID } from "@/lib/map/drive-targets";
import { rolesFor, type RoleItem } from "@/lib/trip/arrival-roles";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/schemas";

/**
 * "Is this stop a town or a city?" for the places on a trip and its destination, so arrival can use an area of kilometres for them and a
 * point for everything else. Decided from our own India place index by name AND position (lib/trip/arrival-roles.ts); no outside service,
 * nothing about the traveller. A place we cannot place is `null` (unknown), never guessed. If the index is unavailable, every place is
 * unknown and arrival works exactly as it did before.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const [tripR, placesR] = await Promise.all([
    Promise.resolve(supabase.from("trips").select("id, dest_name, dest_lat, dest_lng").eq("id", id).maybeSingle()),
    Promise.resolve(supabase.from("places").select("id, name, lat, lng, category").eq("trip_id", id)),
  ]);
  if (tripR.error) return dbError(tripR.error, "arrival roles: trip");
  if (!tripR.data) return jsonError("Trip not found", 404);
  if (placesR.error) return dbError(placesR.error, "arrival roles: places");

  const items: RoleItem[] = ((placesR.data ?? []) as { id: string; name: string; lat: number; lng: number; category: string | null }[]).map((p) => ({ key: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category }));
  const t = tripR.data as { dest_name: string | null; dest_lat: number | null; dest_lng: number | null };
  if (t.dest_name && typeof t.dest_lat === "number" && typeof t.dest_lng === "number") items.push({ key: DESTINATION_ID, name: t.dest_name, lat: t.dest_lat, lng: t.dest_lng, category: null });

  const ix = await loadGeoIndex();
  if (!ix) return NextResponse.json({ ok: true, known: false, roles: {} }, { headers: { "Cache-Control": "private, max-age=60" } });
  const find = (lat: number, lng: number): Nearby[] => nearestTo(ix, lat, lng, ["city", "town", "locality", "subdistrict", "district"], AREA_MATCH_KM, 12).map((x) => ({ name: x.hit.name, kind: x.kind, pop: x.pop, km: x.km }));
  return NextResponse.json({ ok: true, known: true, roles: rolesFor(items, find) }, { headers: { "Cache-Control": "private, max-age=300" } });
}
