import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalContact } from "@/lib/legal";
import { termsSections } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Terms of Use", description: "The rules for using Trailmate." };

export default function TermsPage() {
  const contact = legalContact();
  return <LegalPage title="Terms of Use" intro="The rules for using Trailmate, in plain words." sections={termsSections(contact)} contact={contact} other={{ href: "/privacy", label: "Read the Privacy Policy" }} />;
}
