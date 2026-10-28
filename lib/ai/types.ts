// Shared by every AI provider adapter. The rest of the app only ever sees THIS shape, so the provider can be swapped by
// changing environment variables (AI_PROVIDER) — no code changes.
export class AiNotConfiguredError extends Error {
  constructor(readonly envName = "ANTHROPIC_API_KEY") {
    super(`${envName} is not set`);
  }
}
export class AiRequestError extends Error {
  /** Every attempt that was made and why it failed (never a key). Shown in the setup check so a problem can be fixed, not guessed at. */
  detail: string[];
  constructor(message: string, readonly status?: number, detail: string[] = []) {
    super(message);
    this.detail = detail;
  }
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

/** "Read this and answer by calling this ONE tool": structured output, never free-form text to parse. */
export type ToolCaller = (args: { system: string; content: ContentBlock[]; tool: ToolSpec; maxTokens?: number; /** Stop waiting (and stop retrying) when this fires. */ signal?: AbortSignal }) => Promise<unknown>;
