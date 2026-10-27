import Link from "next/link";

export default function PostNotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-pine">This post isn&apos;t available</h1>
      <p className="text-sm text-ink-muted">It may have been deleted, or its author may have hidden it. Posts you&apos;ve hidden or blocked don&apos;t open either.</p>
      <Link href="/discover" className="inline-flex min-h-12 items-center rounded-full bg-teal px-6 text-sm font-semibold text-white">Back to Discover</Link>
    </main>
  );
}
