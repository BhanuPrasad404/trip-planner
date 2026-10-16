// Password reset: the messages and checks, kept pure so they can be tested.
// Privacy rule: nothing the person sees may reveal whether an email has an account.

export const RESET_PATH = "/reset-password";
export const RESEND_COOLDOWN_S = 60;
export const MIN_PASSWORD_LENGTH = 8;

export const RESET_SENT_MESSAGE =
  "If an account exists for this email, we've sent a link to reset your password. Check your inbox and spam folder. The link works once and expires after about an hour.";
export const RESET_OFFLINE_MESSAGE = "We couldn't reach the server. Check your connection and try again.";
export const RESET_EXPIRED_MESSAGE = "This reset link has expired or was already used. Enter your email to get a new one.";

export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

type AuthLikeError = { name?: string; code?: string; status?: number; message?: string } | null | undefined;

/**
 * What to show after asking Supabase to send a reset email.
 * Every server answer (sent, unknown email, rate limit, …) gets the SAME message, so the page can't be used
 * to find out who has an account. Only a request that never reached the server says so.
 */
export function resetRequestOutcome(error: AuthLikeError, thrown = false): { kind: "sent" | "offline"; message: string } {
  const unreachable = thrown || error?.name === "AuthRetryableFetchError" || error?.status === 0;
  return unreachable ? { kind: "offline", message: RESET_OFFLINE_MESSAGE } : { kind: "sent", message: RESET_SENT_MESSAGE };
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`;
  if (password !== confirm) return "The two passwords don't match. Type the same password in both boxes.";
  return null;
}

/** Plain-language text for a failed password update (Supabase error codes). */
export function passwordUpdateError(error: AuthLikeError): string {
  switch (error?.code) {
    case "same_password":
      return "That is your current password. Choose a different one.";
    case "weak_password":
      return "That password is too easy to guess. Use a longer one with letters and numbers.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "bad_jwt":
      return RESET_EXPIRED_MESSAGE;
    case "reauthentication_needed":
      return "For safety, please request a new reset link and use it straight away.";
  }
  if (error?.name === "AuthRetryableFetchError" || error?.status === 0) return RESET_OFFLINE_MESSAGE;
  return "We couldn't change your password. Please try again, or request a new reset link.";
}
