// SERVER ONLY. Who is asking, for limits only: a signed-in user, or a guest identified by a random cookie and their network.
// Nothing here identifies a person: the cookie is a random number, and both it and the IP address are hashed with a server secret
// before they are counted (lib/places/limits.ts). Neither is ever stored in plain form or shown anywhere.
import { createHmac, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { consumeQuota } from "@/lib/quota";
import { rateLimiter } from "@/lib/rate-limit";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DAILY_LIMITS, USER_QUOTA_KIND, userLimit, type MeteredCall } from "./limits";

export const VISITOR_COOKIE = "tm_vid";
const ONE_YEAR_S = 365 * 24 * 3600;
const DAY_MS = 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Visitor =
  | { kind: "user"; userId: string; supabase: SupabaseClient }
  | { kind: "guest"; key: string; networkKey: string; /** A new random id to store in the cookie (null when the browser already had one). */ newId: string | null };

/** The secret the hashes are made with. Set VISITOR_HASH_SECRET; the service key (also server-only) is used when it is missing. */
function secret(): string {
  return process.env.VISITOR_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "trailmate-dev-only-not-a-secret";
}
export const hashKey = (value: string, s = secret()) => createHmac("sha256", s).update(value).digest("hex").slice(0, 40);

/** The first address in X-Forwarded-For (set by the hosting proxy), else X-Real-IP. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export async function identify(req: Request & { cookies?: { get(name: string): { value: string } | undefined } }): Promise<Visitor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return { kind: "user", userId: user.id, supabase };
  const had = req.cookies?.get(VISITOR_COOKIE)?.value;
  const id = had && UUID.test(had) ? had : randomUUID();
  return { kind: "guest", key: hashKey(`v:${id}`), networkKey: hashKey(`n:${clientIp(req)}`), newId: had === id ? null : id };
}

/** A short handle for per-minute bursts (memory only). */
export const burstKey = (v: Visitor) => (v.kind === "user" ? `u:${v.userId}` : `g:${v.key}`);

/** Gives a new guest their random id. Call on every response of a route that used identify(). */
export function rememberVisitor(res: NextResponse, v: Visitor): NextResponse {
  if (v.kind === "guest" && v.newId) {
    res.cookies.set(VISITOR_COOKIE, v.newId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: ONE_YEAR_S, path: "/" });
  }
  return res;
}

let warned = false;
/**
 * Counts one guest call in the database (consume_visitor_quota, migration 20261024000000). Until that migration is applied, or without
 * the service key, it counts in this server's memory instead: still limited, only less exact across servers.
 */
async function consumeGuest(key: string, kind: string, limit: number): Promise<boolean> {
  if (hasAdminAccess()) {
    try {
      const { data, error } = await createAdminClient().rpc("consume_visitor_quota", { _visitor: key, _kind: kind, _limit: limit });
      if (!error) return data === true;
      if (!warned) { console.error("[places] guest limits fall back to memory:", error.message); warned = true; }
    } catch (err) {
      if (!warned) { console.error("[places] guest limits fall back to memory:", err instanceof Error ? err.message : err); warned = true; }
    }
  }
  return rateLimiter.take(`daily:${kind}:${key}`, limit, DAY_MS);
}

/** May this visitor make one more call of this kind to an outside service today? Counts it when the answer is yes. */
export async function allowCall(v: Visitor, call: MeteredCall): Promise<boolean> {
  if (v.kind === "user") return consumeQuota(v.supabase, USER_QUOTA_KIND[call], userLimit(call));
  const l = DAILY_LIMITS[call];
  return (await consumeGuest(v.networkKey, `net_${call}`, l.guestNetwork)) && (await consumeGuest(v.key, call, l.guest));
}
