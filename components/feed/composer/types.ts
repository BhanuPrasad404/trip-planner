import type { PreparedMedia } from "@/lib/client/prepare-media";

export type ComposerItem = { id: string; name: string; status: "preparing" | "ready" | "error"; error?: string; media?: PreparedMedia; preview?: string };
export type Uploaded = { path: string; posterPath: string | null };
