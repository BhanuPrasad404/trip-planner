import { MapSkeleton, Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main id="main" aria-busy="true" className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
      <span role="status" className="sr-only">Loading live trip</span>
      <div className="rounded-3xl bg-pine/90 p-5 sm:p-6"><Skeleton dark className="h-3 w-28" /><Skeleton dark className="mt-3 h-8 w-1/2" /><SkeletonText lines={1} className="mt-3 max-w-md [&>div]:bg-white/15" /></div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="h-[52vh] min-h-[22rem] overflow-hidden rounded-3xl border border-line lg:h-[62vh]"><MapSkeleton /></div>
        <div className="space-y-5"><Skeleton className="h-56 w-full rounded-2xl" /><Skeleton className="h-32 w-full rounded-2xl" /></div>
      </div>
    </main>
  );
}
