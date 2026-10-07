export default function Loading() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center" aria-busy="true">
      <p role="status" className="font-mono text-sm text-ink-muted">
        Loading…
      </p>
    </main>
  );
}
