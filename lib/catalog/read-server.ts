// SERVER ONLY. The one shared catalogue reader (service-role client), or null when the server has no service key (then the app keeps
// its old path: live map, saved lists, offline list).
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { supabaseCatalogReader, type CatalogReader } from "./read";

let shared: CatalogReader | null | undefined;
export function getCatalogReader(): CatalogReader | null {
  if (shared === undefined) shared = hasAdminAccess() ? supabaseCatalogReader(createAdminClient()) : null;
  return shared;
}
