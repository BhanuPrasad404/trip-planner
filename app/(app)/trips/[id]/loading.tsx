import { CardSkeleton, Skeleton, SkeletonText } from "@/components/ui/Skeleton";

// One trip's page body while it loads (the trip header and tabs above stay on screen).
export default function Loading() {
  return (
    <main id="main" aria-busy="true" className="mx-auto grid grid-cols-1 w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <span role="status" className="sr-only">Loading trip</span>
      <div className="space-y-6">
        <div className="rounded-3xl bg-pine/90 p-6 sm:p-8">
          <Skeleton dark className="h-3 w-24" /><Skeleton dark className="mt-4 h-9 w-2/3" /><SkeletonText lines={2} className="mt-4 max-w-xl [&>div]:bg-white/15" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>
      </div>
      <div className="space-y-4"><Skeleton className="h-48 w-full rounded-2xl" /><Skeleton className="h-32 w-full rounded-2xl" /></div>
    </main>
  );
}
