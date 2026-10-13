import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseBody } from "@/lib/api";
import { reportError } from "@/lib/monitoring";
import { rateLimiter } from "@/lib/rate-limit";

const bodySchema = z.object({
  kind: z.string().max(40),
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
  path: z.string().max(200).optional(),
});

const ip = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || "unknown";

/**
 * Browsers report crashes here. Anyone on the internet can call it, so: only from our own site (Origin check), small bodies,
 * a per-visitor limit, and monitoring's own flood limit behind that. It stores nothing; it only forwards to the alert channel.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    let originHost: string | null = null;
    try { originHost = new URL(origin).host; } catch { /* "null" or malformed Origin */ }
    if (originHost !== host) return jsonError("Not allowed", 403);
  }
  if (Number(req.headers.get("content-length") ?? 0) > 6_000) return jsonError("Too large", 413);
  if (!rateLimiter.take(`client-error:${ip(req)}`, 10, 60_000)) return new NextResponse(null, { status: 204 }); // quietly ignore a noisy browser
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const err = new Error(data.message);
  err.name = `Browser:${data.kind}`;
  if (data.stack) err.stack = `${data.message}\n${data.stack}`;
  reportError(err, { where: "browser", extra: { path: data.path } });
  return new NextResponse(null, { status: 204 });
}
