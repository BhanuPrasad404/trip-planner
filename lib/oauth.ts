// "Continue with Google": the pure rules shared by the button, the callback, the proxy and the welcome step.
import { safeNextPath } from "@/lib/safe-redirect";

export const WELCOME_PATH = "/welcome";
/** Pages a signed-in person who has not agreed yet may still open: the welcome step itself, the documents it links, and auth routes. */
const CONSENT_FREE = ["/welcome", "/terms", "/privacy", "/auth", "/reset-password"];

type Meta = Record<string, unknown> | null | undefined;
type UserLike = { app_metadata?: Meta; user_metadata?: Meta } | null | undefined;

/**
 * Has this person signed in through Google WITHOUT ever agreeing to the Terms and Privacy Policy?
 * Email sign-up requires the tick, so only accounts that came in through Google (and never through the email form) can lack it.
 * Older email accounts are never affected.
 */
export function needsConsent(user: UserLike): boolean {
  if (!user) return false;
  const app = user.app_metadata ?? {};
  const providers = Array.isArray(app.providers) ? (app.providers as unknown[]) : [app.provider];
  const viaGoogle = providers.includes("google");
  const agreed = typeof user.user_metadata?.accepted_terms_version === "string" && (user.user_metadata.accepted_terms_version as string).length > 0;
  return viaGoogle && !agreed;
}

export const consentFree = (path: string) => CONSENT_FREE.some((p) => path === p || path.startsWith(`${p}/`));

/** Where Google sends the person back: our callback, with a SAFE next path (checked again in the callback). */
export function googleRedirectTo(origin: string, next: string | null | undefined): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

export const welcomeUrl = (next: string | null | undefined) => `${WELCOME_PATH}?next=${encodeURIComponent(safeNextPath(next))}`;

/** The name the group sees: what the person typed before, else the name Google gave, else nothing (they type it). */
export function suggestedName(meta: Meta): string {
  for (const k of ["display_name", "full_name", "name"]) {
    const v = meta?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 60);
  }
  return "";
}

/** Plain words for a failed "Continue with Google" (raw provider messages are never shown). */
export function oauthErrorMessage(error: { message?: string; status?: number; name?: string } | null | undefined): string {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Google sign-in isn't switched on yet. Please use your email and password for now.";
  if (error?.name === "AuthRetryableFetchError" || error?.status === 0 || m.includes("fetch")) return "We couldn't reach the sign-in service. Check your connection and try again.";
  return "Google sign-in didn't work just now. Please try again, or use your email and password.";
}
