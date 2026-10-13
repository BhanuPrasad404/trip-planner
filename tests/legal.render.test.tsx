import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null })); // an async server component (reads the session); not part of what is tested here
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { AuthForm } from "@/components/AuthForm";
import { AccountDataPanel } from "@/components/AccountDataPanel";
import { LEGAL_VERSION, legalContact, legalContactComplete } from "@/lib/legal";
import { privacySections, termsSections } from "@/lib/legal-content";

const contact = { operator: "Trailmate Test Co", email: "hello@trailmate.test", address: "Hyderabad, India" };
const text = (s: ReturnType<typeof privacySections>) => JSON.stringify(s).toLowerCase();

describe("legalContact", () => {
  it("reads the three settings and ignores 'fill me in' placeholders", () => {
    expect(legalContact({ NEXT_PUBLIC_LEGAL_NAME: "Acme", NEXT_PUBLIC_CONTACT_EMAIL: "a@b.co", NEXT_PUBLIC_LEGAL_ADDRESS: "Somewhere" })).toEqual({ operator: "Acme", email: "a@b.co", address: "Somewhere" });
    expect(legalContact({ NEXT_PUBLIC_CONTACT_EMAIL: "your-email-here", NEXT_PUBLIC_LEGAL_NAME: "<name>" })).toEqual({ operator: null, email: null, address: null });
  });
  it("complete only when both a name and an email exist", () => {
    expect(legalContactComplete(contact)).toBe(true);
    expect(legalContactComplete({ operator: null, email: "a@b.co", address: null })).toBe(false);
    expect(legalContactComplete({ operator: "A", email: null, address: null })).toBe(false);
  });
});

describe("the Privacy Policy matches what the app really does", () => {
  const t = text(privacySections(contact));
  it("names every outside service the app sends data to", () => {
    for (const s of ["supabase", "vercel", "osrm", "nominatim", "overpass", "open-meteo", "openfreemap", "wikipedia", "gemini", "anthropic", "discord"]) expect(t, s).toContain(s);
  });
  it("covers every kind of data the app keeps", () => {
    for (const d of ["email address", "location", "photos and videos", "comments", "likes", "votes", "notifications", "ip address", "cookie", "feedback", "time-zone"]) expect(t, d).toContain(d);
  });
  it("states the live-location promise the app really keeps (opt-in, deleted on stop, hidden after 6 hours, no history)", () => {
    expect(t).toContain("do not keep a history");
    expect(t).toContain("6 hours");
    expect(t).toContain("stop");
  });
  it("explains the rights the app really implements, by their real button names", () => {
    expect(t).toContain("download my data");
    expect(t).toContain("delete my account");
    expect(t).toContain("handed to the person who has been on it longest");
  });
  it("covers age, security, cookies, transfers abroad, complaints and changes", () => {
    for (const k of ["18", "https", "advertising", "outside india", "data protection board", "changes to this policy"]) expect(t, k).toContain(k);
  });
  it("has unique section ids and every section has text", () => {
    const s = privacySections(contact);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    expect(s.every((x) => x.body.length > 0)).toBe(true);
  });
});

describe("the Terms of Use", () => {
  const t = text(termsSections(contact));
  it("states age, beta status, road safety, content rules, location sharing, liability and governing law", () => {
    for (const k of ["18 years", "early test version", "drive safely", "estimates", "do not post", "sharing your live position", "as is", "courts in hyderabad"]) expect(t, k).toContain(k);
  });
  it("points to the same Download/Delete tools and the Privacy Policy", () => {
    expect(t).toContain("download your data");
    expect(t).toContain("delete your account");
    expect(t).toContain("privacy policy");
  });
});

describe("the pages", () => {
  it("render with their headings, a contents list and a contact block", () => {
    for (const [el, title] of [[<PrivacyPage key="p" />, "Privacy Policy"], [<TermsPage key="t" />, "Terms of Use"]] as const) {
      const h = renderToStaticMarkup(el);
      expect(h).toContain(`<h1`); expect(h).toContain(title); expect(h).toContain("On this page"); expect(h).toContain("Contact"); expect(h).toContain("Last updated");
    }
  });
  it("show the contact details when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_LEGAL_NAME", "Trailmate Test Co"); vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", "hello@trailmate.test");
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain("mailto:hello@trailmate.test");
    vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", ""); vi.stubEnv("NEXT_PUBLIC_LEGAL_NAME", "");
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain("Contact details are being set up");
    vi.unstubAllEnvs();
  });
});

describe("sign-up consent", () => {
  it("sign-up shows the agreement checkbox with links to both documents; log-in does not", () => {
    const signup = renderToStaticMarkup(<AuthForm mode="signup" next="/trips" />);
    expect(signup).toContain('type="checkbox"'); expect(signup).toContain('href="/terms"'); expect(signup).toContain('href="/privacy"'); expect(signup).toContain("18 or older");
    const login = renderToStaticMarkup(<AuthForm mode="login" next="/trips" />);
    expect(login).not.toContain('type="checkbox"');
  });
  it("a notice (for example after deleting an account) is shown on log-in", () => {
    expect(renderToStaticMarkup(<AuthForm mode="login" next="/trips" initialNotice="Your account and data have been deleted." />)).toContain("Your account and data have been deleted.");
  });
  it("the version agreed to is recorded", () => { expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});

describe("Your data panel", () => {
  it("offers the download, and keeps deletion folded away behind one more click", () => {
    const h = renderToStaticMarkup(<AccountDataPanel email="ann@example.com" />);
    expect(h).toContain("Download my data");
    expect(h).toContain("I want to delete my account");
    expect(h).not.toContain("Permanently delete my account"); // the real button only appears after opting in
    expect(h).not.toContain('type="password"');
    expect(h).toContain('href="/privacy"'); expect(h).toContain('href="/terms"');
  });
});
