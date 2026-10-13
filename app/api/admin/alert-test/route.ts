import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { sendTestAlert } from "@/lib/monitoring";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Sends one test message to the alert channel, so you can check the setup. Protected by INGEST_SECRET; absent if that is unset. */
export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || secret.length < 16) return new NextResponse(null, { status: 404 });
  if (!safeEqual(req.headers.get("x-ingest-secret") ?? "", secret)) return jsonError("Not allowed", 401);
  const result = await sendTestAlert();
  if (!result.configured) return jsonError("ALERT_WEBHOOK_URL is not set (or is not an https address).", 400);
  return NextResponse.json(result, { status: result.delivered ? 200 : 502 });
}
