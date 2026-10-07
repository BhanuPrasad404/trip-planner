import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError, AiRequestError, PROVIDER_NAME, callTool } from "@/lib/ai/client";
import { jsonError } from "@/lib/api";
import { aiProviderId, diagnoseAi } from "@/lib/config";
import { consumeQuota } from "@/lib/quota";

export const maxDuration = 30;

// "Test my AI key": makes ONE tiny real request so a wrong/revoked key shows up here instead of in the middle of an import.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!(await consumeQuota(supabase, "ai_test", 10))) return jsonError("You've tested enough for today.", 429);

  try {
    await callTool({
      system: "Reply by calling the tool.",
      content: [{ type: "text", text: "ping" }],
      tool: { name: "pong", description: "Acknowledge", input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
      maxTokens: 20,
    });
    return NextResponse.json({ ok: true, message: `Your ${PROVIDER_NAME[aiProviderId()]} key works.` });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      const d = diagnoseAi();
      return NextResponse.json({ ok: false, message: `${d.problem ?? ""} ${d.fix ?? ""}`.trim() }, { status: 200 });
    }
    if (e instanceof AiRequestError && (e.status === 401 || e.status === 403)) {
      return NextResponse.json({ ok: false, message: `${PROVIDER_NAME[aiProviderId()]} rejected the key (invalid or revoked). Create a new one, update it in your environment settings, and restart the server.` }, { status: 200 });
    }
    if (e instanceof AiRequestError && e.status === 429) return NextResponse.json({ ok: false, message: "The key works but its rate limit is used up for now (free keys are limited). Wait a minute and try again." }, { status: 200 });
    return NextResponse.json({ ok: false, message: `The key is set, but the AI service refused the test. ${e instanceof AiRequestError ? e.message : ""} If it mentions the model, set GEMINI_MODEL / OPENAI_MODEL to a model your provider lists.`.replace(/\s+/g, " ").trim() }, { status: 200 });
  }
}
