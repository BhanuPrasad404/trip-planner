// "Tell me when something breaks" — with no extra service to sign up for and nothing to pay.
//
// When the server (or a visitor's browser) hits an unexpected error we:
//   1. always write it to the logs (Vercel → Logs), with secrets removed, and
//   2. if ALERT_WEBHOOK_URL is set, post a short message to it. A Discord channel webhook (free) puts the message on your phone.
//
// Safe by design:
//   • it can NEVER break a request: every step is wrapped, and it never throws;
//   • no personal data: emails, tokens, keys and secrets in a message are replaced before anything leaves the server;
//   • no flood: the same error is sent once per 10 minutes, and at most 20 messages an hour per server instance;
//   • the webhook address is read only on the server and must be https.
import { after } from "next/server";

export const ALERT_LIMITS = { dedupeMs: 10 * 60_000, perHour: 20, maxChars: 1800 } as const;

export type AlertExtra = Record<string, string | number | boolean | null | undefined>;

/** Remove anything that looks like a secret or a person before text is logged or sent anywhere. */
export function redact(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[token]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]")
    .replace(/([?&](?:access_token|refresh_token|token|code|key|apikey|api_key|secret|password|pwd)=)[^&\s"']+/gi, "$1[hidden]")
    .replace(/\b(?:sk|pk|sb|ghp|gho|AIza|xox[abp])[-_A-Za-z0-9]{16,}\b/g, "[key]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[hex]");
}

export function describeError(e: unknown): { name: string; message: string; stack: string | null } {
  if (e instanceof Error) return { name: e.name || "Error", message: e.message || "(no message)", stack: e.stack ?? null };
  if (typeof e === "string") return { name: "Error", message: e, stack: null };
  try { return { name: "Error", message: JSON.stringify(e).slice(0, 300), stack: null }; } catch { return { name: "Error", message: "(unreadable error)", stack: null }; }
}

/** Same problem → same fingerprint, whatever numbers or ids are inside the message. */
export function fingerprint(where: string, e: { name: string; message: string }): string {
  // ids first (they contain digits too), then plain numbers
  return `${where}|${e.name}|${redact(e.message).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#").replace(/\d+/g, "#").slice(0, 120)}`;
}

export type GateDecision = "send" | "duplicate" | "capped";

/** Decides whether an alert may be sent now. Pure apart from the clock you pass in. */
export function createAlertGate(limits: { dedupeMs: number; perHour: number } = ALERT_LIMITS, now: () => number = Date.now) {
  const lastSent = new Map<string, number>();
  let sentTimes: number[] = [];
  return {
    check(fp: string): GateDecision {
      const t = now();
      sentTimes = sentTimes.filter((x) => t - x < 3_600_000);
      for (const [k, v] of lastSent) if (t - v > limits.dedupeMs) lastSent.delete(k); // keep memory bounded
      if (lastSent.has(fp)) return "duplicate";
      if (sentTimes.length >= limits.perHour) return "capped";
      lastSent.set(fp, t);
      sentTimes.push(t);
      return "send";
    },
  };
}

export function formatAlert(args: { where: string; error: { name: string; message: string; stack: string | null }; extra?: AlertExtra; env?: Record<string, string | undefined> }): string {
  const env = args.env ?? process.env;
  const head = `[Trailmate · ${env.VERCEL_ENV ?? env.NODE_ENV ?? "unknown"}] ${args.where}: ${args.error.name}`;
  const lines = [head, redact(args.error.message).slice(0, 500)];
  const extra = Object.entries(args.extra ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${redact(String(v)).slice(0, 120)}`);
  if (extra.length) lines.push(extra.join("  "));
  const meta = [env.VERCEL_GIT_COMMIT_SHA ? `commit ${env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : null, env.VERCEL_REGION ? `region ${env.VERCEL_REGION}` : null].filter(Boolean);
  if (meta.length) lines.push(meta.join("  "));
  if (args.error.stack) lines.push("```", redact(args.error.stack.split("\n").slice(1, 6).join("\n")).slice(0, 700), "```");
  return lines.join("\n").slice(0, ALERT_LIMITS.maxChars);
}

/** The alert address, or null when not configured / not https. Never logged. */
export function webhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.ALERT_WEBHOOK_URL ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : null;
}

export async function deliver(url: string, text: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    // Discord reads "content", Slack reads "text": sending both works for either.
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 1900), text }), signal: AbortSignal.timeout(3_000) });
    if (!res.ok) console.error(`[monitoring] alert not delivered (HTTP ${res.status})`);
    return res.ok;
  } catch (e) {
    console.error("[monitoring] alert not delivered:", e instanceof Error ? e.name : "error");
    return false;
  }
}

const gate = createAlertGate();

/** Report an unexpected error. Fire-and-forget; never throws. `where` says which part ("api", "server", "browser"...). */
export function reportError(error: unknown, ctx: { where: string; extra?: AlertExtra }): void {
  try {
    const info = describeError(error);
    console.error(`[${ctx.where}]`, info.name, redact(info.message));
    const url = webhookUrl();
    if (!url) return;
    if (gate.check(fingerprint(ctx.where, info)) !== "send") return;
    const text = formatAlert({ where: ctx.where, error: info, extra: ctx.extra });
    const job = () => deliver(url, text);
    try { after(job); } catch { void job(); } // after() only exists inside a request; elsewhere just send
  } catch {
    /* monitoring must never be the thing that breaks a request */
  }
}

/** Send a clearly-labelled test message right now (used by the admin test route). Ignores the flood limits. */
export async function sendTestAlert(): Promise<{ configured: boolean; delivered: boolean }> {
  const url = webhookUrl();
  if (!url) return { configured: false, delivered: false };
  const delivered = await deliver(url, formatAlert({ where: "test", error: { name: "TestAlert", message: "This is a test message from Trailmate. If you can read it, alerts work.", stack: null } }));
  return { configured: true, delivered };
}
