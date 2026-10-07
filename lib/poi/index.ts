// Wires the places service together from configuration. Supabase/PostGIS when a service-role key is present,
// otherwise an in-process store (works, but is lost on restart and not shared between servers).
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { placesProvider } from "@/lib/providers/registry";
import { MemoryPoiStore } from "./store-memory";
import { SupabasePoiStore } from "./store-supabase";
import { PoiService } from "./service";

let memory: MemoryPoiStore | null = null;
let service: PoiService | null = null;
let serviceKey = "";

export function getPoiService(): PoiService {
  const key = `${hasAdminAccess() ? "db" : "mem"}:${placesProvider().id}`;
  if (service && key === serviceKey) return service;
  const store = hasAdminAccess() ? new SupabasePoiStore(createAdminClient()) : (memory ??= new MemoryPoiStore());
  service = new PoiService(store, placesProvider());
  serviceKey = key;
  return service;
}
