import { LinkButton } from "@/components/ui/Button";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
          <p className="font-mono text-sm text-ink-muted">404</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-pine">We couldn&apos;t find that page</h1>
          <p className="mt-3 text-base text-ink-muted">
            The trip may not exist, or you may not have access to it.
          </p>
          <LinkButton href="/trips" className="mt-6">
            Go to my trips
          </LinkButton>
        </div>
      </main>
    </>
  );
}
