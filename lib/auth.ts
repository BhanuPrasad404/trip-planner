import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Server-side auth gate for pages. Authoritative (validates with the Auth server). */
export async function requireUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { supabase, user };
}
