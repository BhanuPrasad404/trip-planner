// Who the legal pages say you are, and when they were last changed. The contact details come from environment variables so
// they are set once (in Vercel) and show on both pages; nothing personal is hard-coded in the repository.
export const LEGAL_VERSION = "2026-10-12";
export const LEGAL_UPDATED_LABEL = "12 October 2026";
/** Minimum age to use Trailmate. */
export const MINIMUM_AGE = 18;

export type LegalContact = { operator: string | null; email: string | null; address: string | null };

const clean = (v: string | undefined): string | null => {
  const t = (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
  return t && !/^(your[-_ ]|xxx|changeme|<|put[-_ ]|replace)/i.test(t) ? t : null;
};

export function legalContact(env: Record<string, string | undefined> = process.env): LegalContact {
  return { operator: clean(env.NEXT_PUBLIC_LEGAL_NAME), email: clean(env.NEXT_PUBLIC_CONTACT_EMAIL), address: clean(env.NEXT_PUBLIC_LEGAL_ADDRESS) };
}

/** True when the pages can honestly tell people how to reach you. Shown as a setup warning otherwise. */
export const legalContactComplete = (c: LegalContact) => !!c.email && !!c.operator;
