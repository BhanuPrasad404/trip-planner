// SERVER ONLY. The guest side of "Ask your group" needs our server's database role for exactly three locked-down functions
// (poll_lookup, guest_group_answer, submit_guest_group_answer — see migration 20261025000000). This file is the only place that uses
// it for that, so the route itself never touches the service key (tests/audit52-security.test.ts checks the routes).
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";

export const guestPollReady = () => hasAdminAccess();

export async function guestLookup(code: string): Promise<{ info: unknown; mine: unknown } | null> {
  if (!hasAdminAccess()) return null;
  const db = createAdminClient();
  const { data: info, error } = await db.rpc("poll_lookup", { p_code: code });
  if (error) return null;
  return { info, mine: null };
}

export async function guestOwnAnswer(code: string, visitorKey: string): Promise<unknown> {
  if (!hasAdminAccess()) return null;
  const { data } = await createAdminClient().rpc("guest_group_answer", { p_code: code, p_visitor_key: visitorKey });
  return data ?? null;
}

export async function guestSubmit(code: string, visitorKey: string, name: string, answers: unknown): Promise<{ data: unknown; error: { message: string } | null } | null> {
  if (!hasAdminAccess()) return null;
  const { data, error } = await createAdminClient().rpc("submit_guest_group_answer", { p_code: code, p_visitor_key: visitorKey, p_name: name, p_answers: answers });
  return { data, error };
}
