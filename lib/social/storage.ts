// Storage is behind a tiny interface so the provider can change (Supabase Storage today; Cloudflare R2 later,
// when video bandwidth outgrows the Supabase plan) without touching routes or UI. Only this file knows the vendor.
import type { SupabaseClient } from "@supabase/supabase-js";
import { POST_MEDIA_BUCKET } from "./media";

export type UploadTarget = { path: string; token: string };
export interface MediaStorage {
  /** One-time permission for the browser to upload exactly this path. */
  createUploadTarget(path: string): Promise<UploadTarget | null>;
  /** True for every path that really exists (so a post cannot point at a file that was never uploaded). */
  allExist(paths: string[]): Promise<boolean>;
  /** Short-lived read URLs. Returns a map path → url; missing/forbidden paths are simply absent. */
  signedUrls(paths: string[], seconds?: number): Promise<Map<string, string>>;
  remove(paths: string[]): Promise<void>;
}

export function supabaseMediaStorage(supabase: SupabaseClient): MediaStorage {
  const bucket = () => supabase.storage.from(POST_MEDIA_BUCKET);
  return {
    async createUploadTarget(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data) { console.error("[media] upload url:", error?.message); return null; }
      return { path: data.path, token: data.token };
    },
    async allExist(paths) {
      const { data, error } = await bucket().createSignedUrls(paths, 60);
      return !error && !!data && data.length === paths.length && data.every((d) => !d.error && !!d.signedUrl);
    },
    async signedUrls(paths, seconds = 3600) {
      const out = new Map<string, string>();
      if (paths.length === 0) return out;
      const { data } = await bucket().createSignedUrls(paths, seconds);
      for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
      return out;
    },
    async remove(paths) {
      if (paths.length) await bucket().remove(paths);
    },
  };
}
