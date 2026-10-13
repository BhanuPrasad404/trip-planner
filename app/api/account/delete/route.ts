import { NextResponse } from "next/server";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { getSupabaseEnv } from "@/lib/env";
import { rateLimiter } from "@/lib/rate-limit";
import { deleteAccount } from "@/lib/server/account";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ confirm: z.string().max(320), password: z.string().min(1).max(200) });

/** Checks a password without creating or replacing any session (a separate, stateless client). */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const { url, anonKey } = getSupabaseEnv();
  const checker = createJsClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await checker.auth.signInWithPassword({ email, password });
  return !error;
}

/** Permanently delete the signed-in person's account. They must type their email and their password. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`account-delete:${user.id}`, 5, 3_600_000)) return jsonError("Too many attempts. Please wait an hour and try again.", 429);
  const { data: input, error: bodyError } = await parseBody(req, bodySchema);
  if (bodyError) return bodyError;
  const result = await deleteAccount({ supabase, user, input, verifyPassword });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json({ ok: true });
}
