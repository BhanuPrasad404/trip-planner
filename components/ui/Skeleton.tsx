// Placeholders shaped like the real content, so the page does not jump when it arrives. Decorative: hidden from screen readers
// (the page-level loaders say "Loading" once). `dark` is for blocks on dark backgrounds (the feed).
const cls = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(" ");

export function Skeleton({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <div aria-hidden="true" className={cls("tm-skeleton rounded-xl", dark && "tm-skeleton-dark", className)} />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cls("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cls("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />)}
    </div>
  );
}

/** A trip/place style card: title, a line, and a button. */
export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-3 h-3.5 w-1/2" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <Skeleton className="mt-5 h-10 w-36 rounded-xl" />
    </div>
  );
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2">{Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}</div>;
}

/** The heading block most pages start with. */
export function PageHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** A map panel: the map area and a bottom sheet. */
export function MapSkeleton({ className = "h-full w-full" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cls("relative overflow-hidden bg-sky", className)}>
      <div className="tm-skeleton absolute inset-0 rounded-none" />
      <div className="absolute left-3 top-3 flex gap-2"><Skeleton className="h-10 w-24 rounded-full" /><Skeleton className="h-10 w-20 rounded-full" /></div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white/90 p-4 shadow"><Skeleton className="h-5 w-40" /><SkeletonText lines={2} className="mt-3" /></div>
    </div>
  );
}

/** One feed slide on its dark background. */
export function FeedSkeleton() {
  return (
    <div aria-hidden="true" className="relative h-full w-full bg-gradient-to-b from-pine/80 to-pine">
      <div className="absolute inset-x-4 bottom-8 space-y-3">
        <Skeleton dark className="h-4 w-32 rounded-full" />
        <Skeleton dark className="h-6 w-3/4" />
        <Skeleton dark className="h-3.5 w-1/2" />
      </div>
      <div className="absolute bottom-10 right-3 space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} dark className="h-11 w-11 rounded-full" />)}</div>
    </div>
  );
}
