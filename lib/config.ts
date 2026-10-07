// SERVER-ONLY configuration checks. Tells the truth about what is (and is not) set up — and, when something is
// missing, WHY and exactly what to do. It never returns a secret's value, only yes/no and a hint.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hasAdminAccess } from "@/lib/supabase/admin";

type Env = Record<string, string | undefined>;

/** Trim, drop surrounding quotes, and treat obvious "fill me in" text as not set. */
export function cleanEnv(value: string | undefined): string | null {
  const v = (value ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!v) return null;
  if (/^(your[-_ ]|xxx|changeme|<|sk-ant-\.\.\.|put[-_ ]|replace)/i.test(v)) return null;
  return v;
}

export type AiProviderId = "anthropic" | "gemini" | "openai";
export const geminiApiKey = (env: Env = process.env): string | null => cleanEnv(env.GEMINI_API_KEY);
export const openaiApiKey = (env: Env = process.env): string | null => cleanEnv(env.OPENAI_API_KEY);

/**
 * Which AI provider to use. Set AI_PROVIDER=anthropic|gemini|openai to choose; otherwise the first key that is present wins
 * (Anthropic, then Gemini, then OpenAI-compatible — which also covers xAI Grok, Groq, OpenRouter via OPENAI_BASE_URL).
 */
export function aiProviderId(env: Env = process.env): AiProviderId {
  const forced = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "anthropic" || forced === "gemini" || forced === "openai") return forced;
  if (anthropicApiKey(env)) return "anthropic";
  if (geminiApiKey(env)) return "gemini";
  if (openaiApiKey(env)) return "openai";
  return "anthropic";
}

export function anthropicApiKey(env: Env = process.env): string | null {
  return cleanEnv(env.ANTHROPIC_API_KEY);
}

export type EnvFileInfo = {
  /** Which .env files exist in the project folder. */
  present: string[];
  /** Misnamed copies that Windows creates when it hides file extensions (e.g. ".env.local.txt"). */
  misnamed: string[];
  /** Does .env.local contain a non-empty line for this variable? (value is never read out) */
  localHasValue: boolean;
  localHasEmptyLine: boolean;
};

export function inspectEnvFiles(variable: string, cwd = process.cwd()): EnvFileInfo {
  const present = [".env.local", ".env", ".env.development.local", ".env.production.local"].filter((f) => existsSync(path.join(cwd, f)));
  const misnamed = [".env.local.txt", ".env.txt", "env.local", ".env.local.example.txt"].filter((f) => existsSync(path.join(cwd, f)));
  let localHasValue = false;
  let localHasEmptyLine = false;
  try {
    for (const line of readFileSync(path.join(cwd, ".env.local"), "utf8").split(/\r?\n/)) {
      const m = new RegExp(`^\\s*${variable}\\s*=\\s*(.*)$`).exec(line);
      if (!m) continue;
      if (cleanEnv(m[1])) localHasValue = true;
      else localHasEmptyLine = true;
    }
  } catch {
    /* no .env.local, or not readable */
  }
  return { present, misnamed, localHasValue, localHasEmptyLine };
}

export type Setup = {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  /** What is wrong, in plain words (null when fine). */
  problem: string | null;
  /** The exact next step (null when fine). */
  fix: string | null;
  /** What still works without it. */
  fallback: string | null;
};

/** Diagnose WHY the Anthropic key is not available to the running server, and what to do. */
export function diagnoseAnthropic(env: Env = process.env, files: EnvFileInfo = inspectEnvFiles("ANTHROPIC_API_KEY"), production = env.NODE_ENV === "production"): Setup {
  const key = anthropicApiKey(env);
  const fallback = "Pasting Google Maps links still works without AI.";
  if (key) {
    const odd = !key.startsWith("sk-ant-");
    return {
      id: "ai", label: "AI import (Anthropic)", ok: true, required: false,
      problem: odd ? "The key is set, but it doesn't start with “sk-ant-”, so it may be the wrong kind of key." : null,
      fix: odd ? "Create a key at console.anthropic.com → API keys, and paste it again." : null,
      fallback: null,
    };
  }
  const raw = (env.ANTHROPIC_API_KEY ?? "").trim();
  const exposed = !!cleanEnv(env.NEXT_PUBLIC_ANTHROPIC_API_KEY);

  let problem: string;
  let fix: string;
  if (exposed) {
    problem = "The key was named NEXT_PUBLIC_ANTHROPIC_API_KEY. That name publishes it to every visitor's browser, and the server does not read it.";
    fix = "Rename it to ANTHROPIC_API_KEY (no NEXT_PUBLIC_), restart the server — and, because it was exposed, create a new key and delete the old one at console.anthropic.com.";
  } else if (production) {
    problem = "The server is running in production and ANTHROPIC_API_KEY is not set in its environment (a .env.local file is not used on the hosting platform).";
    fix = "Add ANTHROPIC_API_KEY in your hosting dashboard (Vercel → Project → Settings → Environment Variables), then redeploy.";
  } else if (files.misnamed.length > 0 && !files.present.includes(".env.local")) {
    problem = `Found “${files.misnamed[0]}” but no .env.local. Windows often hides the real file ending, so the file is not named what you think.`;
    fix = "In File Explorer turn on View → Show → File name extensions, rename it to exactly .env.local (no .txt), then restart the server.";
  } else if (files.localHasValue) {
    problem = "The key IS in .env.local, but this running server has not loaded it. Next.js only reads .env.local when it starts.";
    fix = "Stop the server (press Ctrl + C in the terminal) and run npm run dev again.";
  } else if (files.localHasEmptyLine || raw !== "") {
    problem = "ANTHROPIC_API_KEY is in .env.local but has no real value (it is empty or still the example text).";
    fix = "Put your real key after the = sign, like ANTHROPIC_API_KEY=sk-ant-…  (no quotes or spaces), save, then restart the server.";
  } else if (!files.present.includes(".env.local")) {
    problem = "There is no .env.local file in the project folder, so no keys are loaded.";
    fix = "Copy .env.local.example to .env.local, add ANTHROPIC_API_KEY=sk-ant-… to it, then restart the server.";
  } else {
    problem = ".env.local exists but does not contain ANTHROPIC_API_KEY.";
    fix = "Add a line ANTHROPIC_API_KEY=sk-ant-… to .env.local (key from console.anthropic.com → API keys), save, then restart the server.";
  }
  return { id: "ai", label: "AI import (Anthropic)", ok: false, required: false, problem, fix, fallback };
}

/** Everything the Profile → Setup check shows. Never contains a secret. */
/** Setup status for whichever AI provider is active (see aiProviderId). Never reveals a key. */
export function diagnoseAi(env: Env = process.env, files?: EnvFileInfo, production = env.NODE_ENV === "production"): Setup {
  const id = aiProviderId(env);
  if (id === "gemini") {
    const key = geminiApiKey(env);
    if (key) {
      // Google has changed key formats before, so we do NOT judge the prefix — only an obviously broken value.
      const odd = key.length < 20 || /[\s"']/.test(key);
      return { id: "ai", label: "AI import (Google Gemini)", ok: true, required: false, problem: odd ? "The key is set, but it looks too short or contains spaces or quotes." : null, fix: odd ? "Copy the key again from aistudio.google.com/app/apikey and paste it after GEMINI_API_KEY= with no quotes or spaces." : null, fallback: null };
    }
    return { id: "ai", label: "AI import (Google Gemini)", ok: false, required: false, problem: "AI_PROVIDER=gemini but GEMINI_API_KEY is not set.", fix: "Create a free key at aistudio.google.com/app/apikey, add GEMINI_API_KEY=… to .env.local (or your hosting dashboard), then restart.", fallback: "Pasting Google Maps links still works without AI." };
  }
  if (id === "openai") {
    const key = openaiApiKey(env);
    return key
      ? { id: "ai", label: "AI import (OpenAI-compatible)", ok: true, required: false, problem: null, fix: null, fallback: null }
      : { id: "ai", label: "AI import (OpenAI-compatible)", ok: false, required: false, problem: "AI_PROVIDER=openai but OPENAI_API_KEY is not set.", fix: "Set OPENAI_API_KEY (and OPENAI_BASE_URL / OPENAI_MODEL for xAI Grok, Groq, OpenRouter…), then restart.", fallback: "Pasting Google Maps links still works without AI." };
  }
  const d = diagnoseAnthropic(env, files, production);
  return d.ok ? d : { ...d, fix: `${d.fix ?? ""} Or, just for testing, use a free Google Gemini key instead: set GEMINI_API_KEY (aistudio.google.com/app/apikey) and restart.`.trim() };
}

export function getSetupStatus(env: Env = process.env): Setup[] {
  const adminOk = hasAdminAccess();
  const ingest = cleanEnv(env.INGEST_SECRET);
  const ua = cleanEnv(env.GEOCODER_USER_AGENT);
  return [
    diagnoseAi(env),
    {
      id: "places-db", label: "Own places database", ok: adminOk, required: false,
      problem: adminOk ? null : "SUPABASE_SERVICE_ROLE_KEY is not set, so places found along your route are kept in memory only (lost on restart).",
      fix: adminOk ? null : "Supabase → Project Settings → API → copy the service_role key into .env.local as SUPABASE_SERVICE_ROLE_KEY (server only — never NEXT_PUBLIC_), then restart.",
      fallback: adminOk ? null : "Everything works; places just have to be re-fetched after a restart.",
    },
    {
      id: "ingest", label: "Region pre-loading", ok: !!ingest && ingest.length >= 16, required: false,
      problem: ingest && ingest.length >= 16 ? null : "INGEST_SECRET is not set (or shorter than 16 characters).",
      fix: ingest && ingest.length >= 16 ? null : "Only needed to pre-load whole regions. Add INGEST_SECRET=<16+ random characters> to .env.local and restart.",
      fallback: "Places are still fetched on demand as you plan and travel.",
    },
    {
      id: "geocoder", label: "Place search contact", ok: !!ua && /@|https?:/.test(ua), required: false,
      problem: ua && /@|https?:/.test(ua) ? null : "GEOCODER_USER_AGENT has no contact email/site. OpenStreetMap's rules ask for one.",
      fix: ua && /@|https?:/.test(ua) ? null : "Set GEOCODER_USER_AGENT=Trailmate/1.0 (you@example.com) in .env.local.",
      fallback: "Search works, but may be blocked by OpenStreetMap if usage grows.",
    },
  ];
}
