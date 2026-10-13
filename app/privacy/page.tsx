import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalContact } from "@/lib/legal";
import { privacySections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Privacy Policy", description: "What Trailmate collects, why, who sees it, and how to download or delete your data." };

export default function PrivacyPage() {
  const contact = legalContact();
  return <LegalPage title="Privacy Policy" intro="In plain words: what we collect, why, who can see it, and how you can download or delete it." sections={privacySections(contact)} contact={contact} other={{ href: "/terms", label: "Read the Terms of Use" }} />;
}
