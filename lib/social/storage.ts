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
  /** The bytes of a stored file, for the SERVER to inspect (never trust what a client says about its own upload). null = missing, unreadable or bigger than maxBytes. */
  readBytes(path: string, opts: { maxBytes: number; range?: [number, number] }): Promise<Uint8Array | null>;
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
    async readBytes(path, { maxBytes, range }) {
      try {
        const { data } = await bucket().createSignedUrl(path, 60);
        if (!data?.signedUrl) return null;
        const res = await fetch(data.signedUrl, { headers: range ? { Range: `bytes=${range[0]}-${range[1]}` } : undefined, signal: AbortSignal.timeout(25_000) });
        if (!res.ok && res.status !== 206) return null;
        if (Number(res.headers.get("content-length")) > maxBytes) return null;
        const reader = res.body?.getReader();
        if (!reader) return null;
        const parts: Uint8Array[] = [];
        let total = 0;
        for (;;) {                                           // stop reading the moment it is too big, however it was announced
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) { await reader.cancel(); return null; }
          parts.push(value);
        }
        const out = new Uint8Array(total);
        let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
      } catch (e) {
        console.error("[media] read:", e instanceof Error ? e.message : e);
        return null;
      }
    },
  };
}
