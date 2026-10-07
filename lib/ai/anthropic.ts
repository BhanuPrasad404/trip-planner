// Minimal Anthropic Messages API client (no SDK dependency) that FORCES structured output
// through a single tool call, so we never have to parse free-form model text.

import { anthropicApiKey } from "@/lib/config";

export { AiNotConfiguredError, AiRequestError } from "./types";
export type { ContentBlock, ToolCaller, ToolSpec } from "./types";
import { AiNotConfiguredError, AiRequestError, type ToolCaller } from "./types";

// Fast + cheap model is plenty for extraction. Override with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const callTool: ToolCaller = async ({ system, content, tool, maxTokens = 1500 }) => {
  const apiKey = anthropicApiKey(); // trimmed; placeholder/empty text counts as "not set"
  if (!apiKey) throw new AiNotConfiguredError();

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw new AiRequestError(`AI request failed: ${err instanceof Error ? err.message : "network error"}`);
  }

  if (!res.ok) {
    console.error("[ai] Anthropic error status", res.status);
    throw new AiRequestError(`AI service returned ${res.status}`, res.status);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const block = data.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
  if (!block) throw new AiRequestError("AI returned no structured result");
  return block.input;
};
