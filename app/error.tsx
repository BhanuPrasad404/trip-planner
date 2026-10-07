"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/Button";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Hook up Sentry/LogRocket here when you add monitoring.
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-pine">Something went off-trail</h1>
        <p className="mt-3 text-base text-ink-muted">
          We hit an unexpected problem. Try again, or head back to your trips.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-ink-muted">Ref: {error.digest}</p>}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset}>Try again</Button>
          <LinkButton href="/trips" variant="secondary">
            My trips
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
