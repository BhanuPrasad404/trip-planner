// Any "OpenAI Chat Completions"-style service: OpenAI, xAI Grok (https://api.x.ai/v1), Groq, OpenRouter, Together, …
// Configure with OPENAI_API_KEY, OPENAI_BASE_URL and OPENAI_MODEL.
import { openaiApiKey } from "@/lib/config";
import { AiNotConfiguredError, AiRequestError, type ContentBlock, type ToolCaller, type ToolSpec } from "./types";

const DEFAULT_BASE = "https://api.openai.com/v1";

export const baseUrl = (env: Record<string, string | undefined> = process.env) => (env.OPENAI_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, "");

const part = (b: ContentBlock) => (b.type === "text" ? { type: "text", text: b.text } : { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });

export function buildChatRequest(args: { model: string; system: string; content: ContentBlock[]; tool: ToolSpec; maxTokens: number }) {
  return {
    model: args.model,
    max_tokens: args.maxTokens,
    temperature: 0,
    messages: [{ role: "system", content: args.system }, { role: "user", content: args.content.map(part) }],
    tools: [{ type: "function", function: { name: args.tool.name, description: args.tool.description, parameters: args.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: args.tool.name } },
  };
}

type ChatResponse = { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };

export function parseChatResponse(json: unknown, toolName: string): unknown {
  const calls = (json as ChatResponse | null)?.choices?.[0]?.message?.tool_calls ?? [];
  const call = calls.find((c) => c.function?.name === toolName)?.function;
  if (!call?.arguments) throw new AiRequestError("AI returned no structured result");
  try {
    return JSON.parse(call.arguments);
  } catch {
    throw new AiRequestError("AI returned an unreadable structured result");
  }
}

export const callOpenAiCompatible: ToolCaller = async ({ system, content, tool, maxTokens = 1500 }) => {
  const apiKey = openaiApiKey();
  if (!apiKey) throw new AiNotConfiguredError("OPENAI_API_KEY");
  const model = (process.env.OPENAI_MODEL || "").trim();
  if (!model) throw new AiRequestError("OPENAI_MODEL is not set (for example grok-4 for xAI, or a model your provider lists).");

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildChatRequest({ model, system, content, tool, maxTokens })),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    throw new AiRequestError(`AI request failed: ${err instanceof Error ? err.message : "network error"}`);
  }
  if (!res.ok) {
    console.error("[ai] OpenAI-compatible error status", res.status);
    throw new AiRequestError(`AI service returned ${res.status}`, res.status);
  }
  return parseChatResponse(await res.json(), tool.name);
};
