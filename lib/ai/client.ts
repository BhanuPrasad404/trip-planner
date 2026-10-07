// The ONE entry point the app uses for AI. Picks the provider from the environment (see aiProviderId in lib/config.ts).
import { aiProviderId, type AiProviderId } from "@/lib/config";
import { callTool as callAnthropic } from "./anthropic";
import { callGemini } from "./gemini";
import { callOpenAiCompatible } from "./openai-compatible";
import type { ToolCaller } from "./types";

export { AiNotConfiguredError, AiRequestError } from "./types";
export type { ContentBlock, ToolCaller, ToolSpec } from "./types";

export const PROVIDER_NAME: Record<AiProviderId, string> = { anthropic: "Anthropic", gemini: "Google Gemini", openai: "OpenAI-compatible" };

export const callTool: ToolCaller = (args) => {
  const id = aiProviderId();
  return (id === "gemini" ? callGemini : id === "openai" ? callOpenAiCompatible : callAnthropic)(args);
};
