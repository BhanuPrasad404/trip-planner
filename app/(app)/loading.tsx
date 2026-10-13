import { CardGridSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/Skeleton";

// Inside the app frame (navigation stays on screen): the shape of a typical page while its data loads.
export default function Loading() {
  return (
    <main id="main" aria-busy="true" className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <span role="status" className="sr-only">Loading</span>
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </main>
  );
}
