import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_UPDATED_LABEL, legalContactComplete, type LegalContact } from "@/lib/legal";
import type { Section } from "@/lib/legal-content";

/** One readable page for a legal document: a short contents list, numbered sections, and who to contact. */
export function LegalPage({ title, intro, sections, contact, other }: { title: string; intro: string; sections: Section[]; contact: LegalContact; other: { href: string; label: string } }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-muted">Last updated {LEGAL_UPDATED_LABEL}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-pine sm:text-4xl">{title}</h1>
        <p className="mt-3 text-base text-ink-muted">{intro}</p>

        <nav aria-label="Contents" className="mt-6 rounded-2xl border border-line bg-sky p-4 text-sm">
          <p className="font-semibold text-pine">On this page</p>
          <ol className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-teal-ink underline underline-offset-2">{i + 1}. {s.title}</a></li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 space-y-8">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-20">
              <h2 id={`${s.id}-h`} className="font-display text-xl font-semibold text-pine">{i + 1}. {s.title}</h2>
              <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink">
                {s.body.map((b, j) =>
                  typeof b === "string" ? <p key={j}>{b}</p> : (
                    <ul key={j} className="list-disc space-y-1.5 pl-5">{b.list.map((li, k) => <li key={k}>{li}</li>)}</ul>
                  ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="mt-10 rounded-2xl border border-line bg-white p-5 text-sm">
          <h2 className="font-display text-lg font-semibold text-pine">Contact</h2>
          {legalContactComplete(contact) ? (
            <p className="mt-1 text-ink-muted">{contact.operator}{contact.address ? `, ${contact.address}` : ""}. Email: <a className="font-semibold text-teal-ink underline underline-offset-2" href={`mailto:${contact.email}`}>{contact.email}</a></p>
          ) : (
            <p className="mt-1 text-ink-muted">Contact details are being set up. Until then please reach us through the person who invited you to the test.</p>
          )}
          <p className="mt-3"><Link href={other.href} className="font-semibold text-teal-ink underline underline-offset-2">{other.label}</Link></p>
        </aside>
      </main>
    </>
  );
}
