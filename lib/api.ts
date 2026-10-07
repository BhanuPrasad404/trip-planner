import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Parse + validate a JSON body. Returns either the typed data or a ready-to-return 4xx response. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>
): Promise<{ data: T; error?: undefined } | { data?: undefined; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: jsonError("Request body must be valid JSON", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: jsonError(parsed.error.issues[0]?.message ?? "Invalid input", 400) };
  }
  return { data: parsed.data };
}

/** Map a Postgres/PostgREST error to a safe client response — never leak raw DB messages. */
export function dbError(error: { code?: string; message?: string }, context: string) {
  console.error(`[api] ${context}:`, error.code, error.message);
  if (error.code === "42501") return jsonError("You don't have access to this trip", 403);
  if (error.code === "23503") return jsonError("Related record not found", 404);
  if (error.code === "23514" || error.code === "22P02") return jsonError("Invalid input", 400);
  return jsonError("Something went wrong. Please try again.", 500);
}
