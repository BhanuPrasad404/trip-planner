import type { SupabaseClient } from "@supabase/supabase-js";

/** Returns true if the user is under their limit (and records the use), false if they've hit it. */
export async function consumeQuota(
  supabase: SupabaseClient,
  kind: string,
  limit: number,
  window = "24 hours"
): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_quota", { _kind: kind, _limit: limit, _window: window });
  if (error) {
    console.error("[quota] failed:", error.message);
    return false; // fail CLOSED: if we can't meter paid usage, don't allow it
  }
  return data === true;
}

export const importDailyLimit = () => {
  const n = Number(process.env.IMPORT_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 40;
};
