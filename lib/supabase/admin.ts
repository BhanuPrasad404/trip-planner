// SERVER-ONLY. Service-role client: bypasses Row Level Security, so it is used ONLY for things users must never write
// themselves (ingesting places into our own database). Never import this from a Client Component.
import { createClient } from "@supabase/supabase-js";

export const hasAdminAccess = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
